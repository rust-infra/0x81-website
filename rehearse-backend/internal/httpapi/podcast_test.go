package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/0x81/rehearse-backend/internal/store/storetest"
)

const testClipKey = "0123456789abcdef01234567"

func fakeDigitalHuman(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/clips":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"key":"` + testClipKey + `","status":"queued","queuePosition":1}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/clips/"+testClipKey:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"key":"` + testClipKey + `","status":"ready","url":"/v1/clips/` + testClipKey + `/video","version":"anchor-v1"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/clips/"+testClipKey+"/video":
			w.Header().Set("Content-Type", "video/mp4")
			w.Header().Set("Accept-Ranges", "bytes")
			if r.Header.Get("Range") == "bytes=0-3" {
				w.Header().Set("Content-Range", "bytes 0-3/8")
				w.WriteHeader(http.StatusPartialContent)
				_, _ = w.Write([]byte("MP4!"))
				return
			}
			_, _ = w.Write([]byte("MP4DATA!"))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/poster":
			w.Header().Set("Content-Type", "image/jpeg")
			_, _ = w.Write([]byte("JPEGDATA"))
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestPodcastClipProxyRewritesURLAndStreamsVideo(t *testing.T) {
	upstream := fakeDigitalHuman(t)
	t.Cleanup(upstream.Close)

	deps := newTestDeps(t, storetest.New())
	deps.DigitalHumanURL = upstream.URL
	router := NewRouter(deps)
	auth := "Bearer " + token(t, "active")

	body := strings.NewReader(`{"text":"Alex, please introduce yourself."}`)
	req := httptest.NewRequest(http.MethodPost, "/api/rehearse/podcast/clips", body)
	req.Header.Set("Authorization", auth)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	var created struct {
		Data podcastClipStatus `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &created))
	assert.Equal(t, testClipKey, created.Data.Key)
	assert.Equal(t, "queued", created.Data.Status)
	assert.Empty(t, created.Data.URL)

	statusReq := httptest.NewRequest(http.MethodGet, "/api/rehearse/podcast/clips/"+testClipKey, nil)
	statusReq.Header.Set("Authorization", auth)
	statusRec := httptest.NewRecorder()
	router.ServeHTTP(statusRec, statusReq)
	require.Equal(t, http.StatusOK, statusRec.Code)
	var statusBody struct {
		Data podcastClipStatus `json:"data"`
	}
	require.NoError(t, json.Unmarshal(statusRec.Body.Bytes(), &statusBody))
	assert.Equal(t, "ready", statusBody.Data.Status)
	assert.Equal(t, "/api/rehearse/podcast/clips/"+testClipKey+"/video?v=anchor-v1", statusBody.Data.URL)

	videoReq := httptest.NewRequest(http.MethodGet, "/api/rehearse/podcast/clips/"+testClipKey+"/video", nil)
	videoReq.Header.Set("Authorization", auth)
	videoReq.Header.Set("Range", "bytes=0-3")
	videoRec := httptest.NewRecorder()
	router.ServeHTTP(videoRec, videoReq)
	require.Equal(t, http.StatusPartialContent, videoRec.Code)
	video, err := io.ReadAll(videoRec.Body)
	require.NoError(t, err)
	assert.Equal(t, "MP4!", string(video))
	assert.Equal(t, "bytes 0-3/8", videoRec.Header().Get("Content-Range"))

	posterReq := httptest.NewRequest(http.MethodGet, "/api/rehearse/podcast/poster", nil)
	posterReq.Header.Set("Authorization", auth)
	posterRec := httptest.NewRecorder()
	router.ServeHTTP(posterRec, posterReq)
	require.Equal(t, http.StatusOK, posterRec.Code)
	poster, err := io.ReadAll(posterRec.Body)
	require.NoError(t, err)
	assert.Equal(t, "JPEGDATA", string(poster))
	assert.Equal(t, "image/jpeg", posterRec.Header().Get("Content-Type"))
}

func TestPodcastClipRejectsBadKeyAndMissingService(t *testing.T) {
	upstream := fakeDigitalHuman(t)
	t.Cleanup(upstream.Close)

	deps := newTestDeps(t, storetest.New())
	deps.DigitalHumanURL = upstream.URL
	router := NewRouter(deps)
	auth := "Bearer " + token(t, "active")

	bad := httptest.NewRequest(http.MethodGet, "/api/rehearse/podcast/clips/not-a-key", nil)
	bad.Header.Set("Authorization", auth)
	badRec := httptest.NewRecorder()
	router.ServeHTTP(badRec, bad)
	assert.Equal(t, http.StatusNotFound, badRec.Code)

	missingRouter := NewRouter(newTestDeps(t, storetest.New()))
	missing := httptest.NewRequest(http.MethodPost, "/api/rehearse/podcast/clips", strings.NewReader(`{"text":"hi"}`))
	missing.Header.Set("Authorization", auth)
	missingRec := httptest.NewRecorder()
	missingRouter.ServeHTTP(missingRec, missing)
	assert.Equal(t, http.StatusServiceUnavailable, missingRec.Code)
}
