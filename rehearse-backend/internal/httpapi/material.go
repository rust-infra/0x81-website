package httpapi

import (
	"encoding/base64"
	"io"
	"mime/multipart"
	"net/http"

	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/material"
	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/model"
)

// 本文件是 `/api/rehearse/material/*`（原 `/interview/*`，§7.6 改名）。
//
// 移植自 `moyan-backend/src/controllers/coach.rs:80-162`，
// 目标文件是设计稿 §7.9 指定的 `internal/httpapi/material.go`。

// maxUploadBodyBytes 是上传体的上限，与 `material.MaxUploadBytes` 一致（10 MiB）。
//
// 两层都要设：这一层是 HTTP 层的硬闸（超了直接断开，不读完），
// `material.ParseDocument` 那层是业务校验（能给出「文件太大」这条文案）。
// 只有前者的话用户看到的是连接中断，只有后者的话内存已经吃完了。
const maxUploadBodyBytes = material.MaxUploadBytes

// multipart 字段名。Rust 用 `docs`（可多份，只取第一份）与 `images`（可多张）。
const (
	fieldDocs   = "docs"
	fieldImages = "images"
)

// materialTextHandler 是 `POST /api/rehearse/material/text`。
//
// 两条分支：有图片就走视觉模型逐字识别；否则取第一份文档抽文本。
// **图片优先**——与 Rust 的判断顺序一致（`controllers/coach.rs:120`）：
// 同时传了两者时按图片处理，因为图片是「文档抽不出文本」的兜底路径。
func materialTextHandler(ocr *material.OCRService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := requireClaims(w, r)
		if !ok {
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxUploadBodyBytes)
		// maxMemory 与 body 上限相同：**保证一个字节都不落盘**。
		// §10 的隐私约定是材料只在内存里处理，而 ParseMultipartForm 在超过
		// maxMemory 时会把部分内容写进系统临时目录——那样「不落盘」就破了。
		if err := r.ParseMultipartForm(maxUploadBodyBytes); err != nil {
			middleware.WriteError(w, middleware.BadRequest("invalid multipart: "+err.Error()))
			return
		}
		defer func() {
			if r.MultipartForm != nil {
				// 正常路径下没有临时文件（见上），这里是防御性清理。
				_ = r.MultipartForm.RemoveAll()
			}
		}()

		images, err := readImages(r.MultipartForm.File[fieldImages])
		if err != nil {
			middleware.WriteError(w, err)
			return
		}

		if len(images) > 0 {
			text, err := ocr.OCR(r.Context(), claims.Sub, images)
			if err != nil {
				middleware.WriteError(w, err)
				return
			}
			middleware.WriteData(w, http.StatusOK, model.MaterialTextResponse{
				Text:      text,
				CharCount: len([]rune(text)),
				// 图片路径**恒为 false**：OCR 本来就是逐字识别，
				// 「像扫描件」这个提示只对文档路径有意义（Rust 同样写死 false）。
				LikelyScanned: false,
				Source:        model.MaterialSourceImage,
			})
			return
		}

		docs := r.MultipartForm.File[fieldDocs]
		if len(docs) == 0 {
			middleware.WriteError(w, middleware.BadRequest("docs or images is required"))
			return
		}
		fileName, data, err := readFile(docs[0])
		if err != nil {
			middleware.WriteError(w, err)
			return
		}
		parsed, err := material.ParseDocument(fileName, data)
		if err != nil {
			middleware.WriteError(w, err)
			return
		}
		middleware.WriteData(w, http.StatusOK, model.MaterialTextResponse{
			Text:          parsed.Text,
			CharCount:     parsed.CharCount,
			LikelyScanned: parsed.LikelyScanned,
			Source:        model.MaterialSourceDocument,
		})
	}
}

// materialProfileHandler 是 `POST /api/rehearse/material/profile`。
//
// 输入是**用户确认过的文本**（图片与原文在确认之后就不再参与），
// 输出是之后挂到 `/turn` 与 `/summary` 上的紧凑档案。
func materialProfileHandler(profile *material.ProfileService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := requireClaims(w, r)
		if !ok {
			return
		}
		var req model.MaterialProfileRequest
		if err := decodeJSON(w, r, &req); err != nil {
			middleware.WriteError(w, err)
			return
		}
		out, err := profile.Profile(r.Context(), claims.Sub, req)
		if err != nil {
			middleware.WriteError(w, err)
			return
		}
		middleware.WriteData(w, http.StatusOK, out)
	}
}

// readImages 把上传的图片读成 `llm.ImagePart`。
//
// 与 Rust 一致（`controllers/coach.rs:104-116`）：media_type 取不到时按
// `image/jpeg` 兜底——很多客户端不会给 multipart part 带 Content-Type，
// 而拒绝它们会让「拍照上传」这条主路径直接不可用。真正的类型/体积校验
// 在 `llm.ValidateImages` 里（它按 media_type 前缀判断，兜底值能过）。
func readImages(headers []*multipart.FileHeader) ([]llm.ImagePart, error) {
	out := make([]llm.ImagePart, 0, len(headers))
	for _, header := range headers {
		data, err := readAll(header)
		if err != nil {
			return nil, err
		}
		mediaType := header.Header.Get("Content-Type")
		if mediaType == "" {
			mediaType = "image/jpeg"
		}
		out = append(out, llm.ImagePart{
			MediaType:  mediaType,
			DataBase64: base64.StdEncoding.EncodeToString(data),
		})
	}
	return out, nil
}

func readFile(header *multipart.FileHeader) (string, []byte, error) {
	data, err := readAll(header)
	if err != nil {
		return "", nil, err
	}
	return header.Filename, data, nil
}

func readAll(header *multipart.FileHeader) ([]byte, error) {
	file, err := header.Open()
	if err != nil {
		return nil, middleware.BadRequest("read upload: " + err.Error())
	}
	defer file.Close()

	// 再套一层 LimitReader：`ParseMultipartForm` 的上限是**整个 body**，
	// 单份文件仍可能吃掉全部额度，这里按单文件上限截断。
	data, err := io.ReadAll(io.LimitReader(file, maxUploadBodyBytes+1))
	if err != nil {
		return nil, middleware.BadRequest("read upload: " + err.Error())
	}
	if len(data) > maxUploadBodyBytes {
		return nil, middleware.BadRequest("uploaded file is too large")
	}
	return data, nil
}
