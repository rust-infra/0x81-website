package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/0x81/rehearse-backend/internal/middleware"
)

const (
	maxPodcastText  = 1200
	maxPodcastVoice = 64
)

var podcastClipKey = regexp.MustCompile(`^[a-f0-9]{24}$`)

type podcastClipRequest struct {
	Text    string `json:"text"`
	Voice   string `json:"voice,omitempty"`
	Enqueue *bool  `json:"enqueue,omitempty"`
}

type podcastClipStatus struct {
	Key           string `json:"key"`
	Status        string `json:"status"`
	URL           string `json:"url,omitempty"`
	Error         string `json:"error,omitempty"`
	QueuePosition *int   `json:"queuePosition,omitempty"`
	Version       string `json:"version,omitempty"`
}

func digitalHumanEndpoint(base, path string) string {
	return strings.TrimRight(base, "/") + path
}

func podcastClipCreateHandler(base string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.TrimSpace(base) == "" {
			middleware.Abort(c, middleware.ServiceUnavailable("Digital human is not configured"))
			return
		}
		var req podcastClipRequest
		if err := bindJSON(c, &req); err != nil {
			middleware.Abort(c, err)
			return
		}
		req.Text = strings.TrimSpace(req.Text)
		if req.Text == "" {
			middleware.Abort(c, middleware.BadRequest("text is required"))
			return
		}
		if len([]rune(req.Text)) > maxPodcastText {
			middleware.Abort(c, middleware.BadRequest("text is too long"))
			return
		}
		if len([]rune(req.Voice)) > maxPodcastVoice {
			middleware.Abort(c, middleware.BadRequest("voice is too long"))
			return
		}
		out, err := postDigitalHuman(c.Request.Context(), base, "/v1/clips", req)
		if err != nil {
			abortDigitalHuman(c, err)
			return
		}
		writePodcastClip(c, out)
	}
}

func podcastClipStatusHandler(base string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.TrimSpace(base) == "" {
			middleware.Abort(c, middleware.ServiceUnavailable("Digital human is not configured"))
			return
		}
		key := c.Param("key")
		if !podcastClipKey.MatchString(key) {
			middleware.Abort(c, middleware.NotFound("Clip not found"))
			return
		}
		out, err := getDigitalHuman(c.Request.Context(), base, "/v1/clips/"+key)
		if err != nil {
			abortDigitalHuman(c, err)
			return
		}
		writePodcastClip(c, out)
	}
}

func podcastClipVideoHandler(base string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.TrimSpace(base) == "" {
			middleware.Abort(c, middleware.ServiceUnavailable("Digital human is not configured"))
			return
		}
		key := c.Param("key")
		if !podcastClipKey.MatchString(key) {
			middleware.Abort(c, middleware.NotFound("Clip not found"))
			return
		}
		req, err := http.NewRequestWithContext(
			c.Request.Context(),
			http.MethodGet,
			digitalHumanEndpoint(base, "/v1/clips/"+key+"/video"),
			nil,
		)
		if err != nil {
			middleware.Abort(c, middleware.ServiceUnavailable("Digital human service is unavailable"))
			return
		}
		if value := c.GetHeader("Range"); value != "" {
			req.Header.Set("Range", value)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			middleware.Abort(c, middleware.ServiceUnavailable("Digital human service is unavailable"))
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusNotFound {
			middleware.Abort(c, middleware.NotFound("Clip not ready"))
			return
		}
		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
			middleware.Abort(c, middleware.ServiceUnavailable("Digital human service is unavailable"))
			return
		}
		c.Header("Content-Type", "video/mp4")
		c.Header("Accept-Ranges", "bytes")
		c.Header("Cache-Control", "private, max-age=86400")
		if value := resp.Header.Get("Content-Length"); value != "" {
			c.Header("Content-Length", value)
		}
		if value := resp.Header.Get("Content-Range"); value != "" {
			c.Header("Content-Range", value)
		}
		c.Status(resp.StatusCode)
		_, _ = io.Copy(c.Writer, resp.Body)
	}
}

func podcastPosterHandler(base string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.TrimSpace(base) == "" {
			middleware.Abort(c, middleware.ServiceUnavailable("Digital human is not configured"))
			return
		}
		req, err := http.NewRequestWithContext(
			c.Request.Context(),
			http.MethodGet,
			digitalHumanEndpoint(base, "/v1/poster"),
			nil,
		)
		if err != nil {
			middleware.Abort(c, middleware.ServiceUnavailable("Digital human service is unavailable"))
			return
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			middleware.Abort(c, middleware.ServiceUnavailable("Digital human service is unavailable"))
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusNotFound {
			middleware.Abort(c, middleware.NotFound("Poster not found"))
			return
		}
		if resp.StatusCode != http.StatusOK {
			middleware.Abort(c, middleware.ServiceUnavailable("Digital human service is unavailable"))
			return
		}
		c.Header("Content-Type", "image/jpeg")
		c.Header("Cache-Control", "private, max-age=86400")
		if value := resp.Header.Get("Content-Length"); value != "" {
			c.Header("Content-Length", value)
		}
		c.Status(http.StatusOK)
		_, _ = io.Copy(c.Writer, resp.Body)
	}
}

func writePodcastClip(c *gin.Context, out podcastClipStatus) {
	if out.Status == "ready" {
		out.URL = "/api/rehearse/podcast/clips/" + out.Key + "/video"
		if out.Version != "" {
			out.URL += "?v=" + url.QueryEscape(out.Version)
		}
	} else {
		out.URL = ""
	}
	middleware.OK(c, out)
}

func abortDigitalHuman(c *gin.Context, err error) {
	slog.Error("digital human upstream failed", "err", err)
	var upstream *upstreamError
	if errors.As(err, &upstream) {
		switch upstream.status {
		case http.StatusBadRequest:
			middleware.Abort(c, middleware.BadRequest("Invalid clip request"))
			return
		case http.StatusNotFound:
			middleware.Abort(c, middleware.NotFound("Clip not found"))
			return
		}
	}
	middleware.Abort(c, middleware.ServiceUnavailable("Digital human service is unavailable"))
}

func postDigitalHuman(ctx context.Context, base, path string, payload any) (podcastClipStatus, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return podcastClipStatus{}, err
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		digitalHumanEndpoint(base, path),
		bytes.NewReader(body),
	)
	if err != nil {
		return podcastClipStatus{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return podcastClipStatus{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		_, _ = io.Copy(io.Discard, resp.Body)
		return podcastClipStatus{}, &upstreamError{status: resp.StatusCode}
	}
	var out podcastClipStatus
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return podcastClipStatus{}, err
	}
	return out, nil
}

func getDigitalHuman(ctx context.Context, base, path string) (podcastClipStatus, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, digitalHumanEndpoint(base, path), nil)
	if err != nil {
		return podcastClipStatus{}, err
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return podcastClipStatus{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		_, _ = io.Copy(io.Discard, resp.Body)
		return podcastClipStatus{}, &upstreamError{status: resp.StatusCode}
	}
	var out podcastClipStatus
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return podcastClipStatus{}, err
	}
	return out, nil
}

type upstreamError struct{ status int }

func (e *upstreamError) Error() string { return "digital human upstream error" }
