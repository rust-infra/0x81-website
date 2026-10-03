module github.com/0x81/rehearse-backend

go 1.23

require (
	github.com/gin-gonic/gin v1.10.0
	github.com/golang-jwt/jwt/v5 v5.2.1
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.7.1
	github.com/ledongthuc/pdf v0.0.0-20220302134840-0c2507a12d80
	github.com/rs/cors v1.11.1
	github.com/stretchr/testify v1.9.0
)

require (
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/gabriel-vasile/mimetype v1.4.3 // indirect
	github.com/gin-contrib/sse v0.1.0 // indirect
	github.com/go-playground/locales v0.14.1 // indirect
	github.com/go-playground/universal-translator v0.18.1 // indirect
	github.com/go-playground/validator/v10 v10.20.0 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/leodido/go-urn v1.4.0 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/pelletier/go-toml/v2 v2.2.2 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/ugorji/go/codec v1.2.12 // indirect
	golang.org/x/crypto v0.27.0 // indirect
	golang.org/x/net v0.25.0 // indirect
	golang.org/x/sync v0.8.0 // indirect
	golang.org/x/sys v0.25.0 // indirect
	golang.org/x/text v0.18.0 // indirect
	google.golang.org/protobuf v1.34.1 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

// 测试依赖的传递依赖，**显式钉住版本**。
//
// 链条：testify → yaml.v3（它的测试）→ check.v1（它的测试）→ kr/pretty →
// rogpeppe/go-internal。这条链只为了 `go mod tidy` 能把模块图解析完整而存在，
// 没有任何生产代码 import 它们（所以全是 indirect）。
//
// ⚠️ 不钉的话，`go mod tidy` 会把 rogpeppe/go-internal 解析到 v1.16.0，
// 而那个版本要求 **go >= 1.25**，与本仓的 go 1.23 冲突——tidy 直接失败，
// 报「toolchain upgrade needed」。钉在 v1.12.0 是最后一批支持 go 1.23 的版本。
require (
	github.com/kr/pretty v0.3.1 // indirect
	github.com/kr/text v0.2.0 // indirect
	github.com/rogpeppe/go-internal v1.12.0 // indirect
)
