// 播客台词的整集译文：读缓存与生成。
//
// 两个端点而不是一个「GET 没有就顺手翻」：生成是重操作（一次大请求、
// 花额度），读是轻操作（一次索引查询）。合成一个端点的话，播放器每次
// 打开都会在缺译文时触发一次生成，而用户可能只是想听英文。
//
//	· `POST /api/rehearse/podcast/translations` 只读已存的整集译文
//	· `POST /api/rehearse/podcast/translations/generate` 生成（幂等，
//	  已缓存时直接返回）
package httpapi

import (
	"github.com/gin-gonic/gin"

	"github.com/0x81/rehearse-backend/internal/coach"
	"github.com/0x81/rehearse-backend/internal/middleware"
)

func podcastTranslationsHandler(captions *coach.PodcastCaptionService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req coach.PodcastTranslationsRequest
		if err := bindJSON(c, &req); err != nil {
			middleware.Abort(c, err)
			return
		}
		out, err := captions.Stored(c.Request.Context(), req)
		if err != nil {
			middleware.Abort(c, err)
			return
		}
		middleware.OK(c, out)
	}
}

func podcastTranslationsGenerateHandler(captions *coach.PodcastCaptionService) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, ok := requireClaims(c)
		if !ok {
			return
		}
		var req coach.PodcastTranslationsRequest
		if err := bindJSON(c, &req); err != nil {
			middleware.Abort(c, err)
			return
		}
		out, err := captions.Generate(c.Request.Context(), claims.Sub, req)
		if err != nil {
			middleware.Abort(c, err)
			return
		}
		middleware.OK(c, out)
	}
}
