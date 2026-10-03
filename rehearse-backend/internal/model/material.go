package model

// 材料导入（原 `/interview/*`，§7.6 改名 `/material/*`）的线上契约类型。

// MaterialSource 说明这段文本是从哪条路径来的。
//
// App 用它决定后续提示：文档路径要提示「可能是扫描件」，
// 图片路径不用（OCR 本来就是逐字识别）。
type MaterialSource string

const (
	MaterialSourceDocument MaterialSource = "document"
	MaterialSourceImage    MaterialSource = "image"
)

// MaterialTextResponse 是 `POST /api/rehearse/material/text` 的响应。
type MaterialTextResponse struct {
	Text      string `json:"text"`
	CharCount int    `json:"char_count"`
	// LikelyScanned 在字符数低于阈值时为 true：多半是扫描件，
	// App 会提示改用图片上传（§10.2）。
	LikelyScanned bool           `json:"likely_scanned"`
	Source        MaterialSource `json:"source"`
}

// MaterialProfileRequest 是 `POST /api/rehearse/material/profile` 的请求体。
//
// `kind` 只有 resume / job 两个取值——**注意与 `MaterialContext.Kind` 不同**：
// 后者多了 `resume_job`（简历与 JD 合并后的档案），那是**产出**，
// 不是这个接口的输入。
type MaterialProfileRequest struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

// MaterialProfileResponse 是 `POST /api/rehearse/material/profile` 的响应。
//
// 这段 `profile` 就是之后挂到 `/turn` 与 `/summary` 上的
// `MaterialContext.Profile`。
type MaterialProfileResponse struct {
	Kind    string `json:"kind"`
	Profile string `json:"profile"`
}

// MaterialProfileKinds 是 `MaterialProfileRequest.Kind` 的合法取值。
var MaterialProfileKinds = []string{"resume", "job"}
