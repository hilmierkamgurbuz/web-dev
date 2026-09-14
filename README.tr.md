# web-dev

Web geliştirmeyi disiplinli ve doğrulanabilir bir döngüye çeviren Claude Code plugin'i. JavaScript/TypeScript ile yeni ya da devam eden projelerde çalışır: React, Next.js, Vue, Nuxt, Svelte/SvelteKit, Node, Express, NestJS, Fastify, Hono.

[English README](README.md)

Model aynı kalır; değişen, etrafındaki **harness**'tır: modelin ne gördüğü, neyi yazabildiği ve neyin "bitti" sayıldığı. 2026 ajan araştırmaları (NVIDIA'nın harness çalışması dahil) aynı sonucu gösteriyor: deterministik kapılar, diskte açık durum, bir supervisor ve damıtılmış bağlam, prompt ifadesinden daha belirleyici. web-dev bu fikirleri web işine uyarlar.

## Neler sağlar

- **Önce soru, sonra kod.** Kullanıcının isteği kelimesi kelimesine saklanır; AI'ın bunu nasıl anladığı kullanıcıya teyit ettirilir. Sonucu değiştiren her açık nokta 2–4 seçenek, bir öneri ve tek satırlık artı/eksi ile sorulur. Hiçbir şey tahmin edilmez.
- **Plan modu yerine onaylı brief.** Plan tek bir dosyadadır: hedef, kararlar, kabul kriterleri, riskler, testler ve yazılacak dosyaların tam listesi (manifest). Kullanıcı tek tıkla onaylar; brief değişirse onay düşer.
- **Hook ile zorlanan kapılar.** Şunlar yazım anında engellenir: manifest dışı yazım, default branch'e yazım, bilinen zafiyet sınıfları, koda eklenen yorumlar, beyan edilmemiş bağımlılıklar ve yıkıcı migration'lar. Tur sonunda o turda değişen her dosya yeniden taranır.
- **Bayatlamayan haritalar.** Kod, API, UI ve veri haritaları, koddan ve her fonksiyon için AI'ın yazdığı kısa notlardan üretilir. Normalize edilmiş fonksiyon gövdesinin hash'i, hangi notun yenilenmesi gerektiğini tam olarak gösterir. Eksik not varken Stop hook'u turun bitmesine izin vermez.
- **Frontend ↔ backend bağlantı haritası.** Her route için handler, auth, input şeması, tablolar ve frontend'deki çağıranlar listelenir. Eşleşmeyen çağrılar, auth'suz mutation'lar ve doğrulanmamış input hata olarak görünür.
- **Responsive ve erişilebilirlik kontrolü.** Playwright her route'u 360, 768 ve 1440 px genişlikte açar. Taşmaları, küçük dokunma alanlarını, küçük metinleri, konsol hatalarını ve axe ihlallerini raporlar, ekran görüntülerini inceleme için saklar.
- **Supervisor inceleme.** Salt okunur, bağımsız bir reviewer subagent diff'i brief'e göre denetler; bu olmadan task kapanmaz.
- **Branch → PR → /clear.** Her task kendi branch'inde açıklamalı commit'lerle ilerler, push edilir ve PR açılır. Stop hook'u her şeyi doğruladıktan sonra task'i kapatır ve kullanıcıya `/clear` önerir. Tüm durum diskte olduğu için `/clear` hiçbir şey kaybettirmez.

## Gereksinimler

- Claude Code 2.1.200 veya üstü.
- Node.js 20 veya üstü ve git.
- Opsiyonel:
  - PR kontrolü için `gh`.
  - Derin güvenlik taraması için `gitleaks`, `opengrep` (ya da `semgrep`) ve `osv-scanner`.
  - `wd responsive` için projede `@playwright/test` ve `@axe-core/playwright`.

macOS, Linux ve Windows'ta çalışır. Hook'lar exec-form ile başlatılan Node script'leridir, arada shell yoktur.

## Kurulum

Bu GitHub reposu hem bir Claude Code plugin marketplace'i (`.claude-plugin/marketplace.json`) hem de plugin'in kendisidir (`.claude-plugin/plugin.json`, `SKILL.md`, `skills/`).

**Claude Code içinden**

```text
/plugin marketplace add hilmierkamgurbuz/web-dev
/plugin install web-dev@web-dev
```

Kurulum özeti isterse ardından `/reload-plugins` çalıştırın.

**Terminalden**

```bash
claude plugin marketplace add hilmierkamgurbuz/web-dev
claude plugin install web-dev@web-dev
claude plugin list
```

**Belirli bir sürüme sabitlemek** için marketplace'i `main` yerine bir sürüm etiketinden ekleyin:

```bash
claude plugin marketplace add https://github.com/hilmierkamgurbuz/web-dev.git#web-dev--v1.1.0
```

**Güncellemek**

```bash
claude plugin marketplace update web-dev
claude plugin update web-dev@web-dev
```

Güncellemeden sonra her projede `/web-dev:init`'i tekrar çalıştırın; projedeki hook'lar yeni sürüme eşitlenir.

**Kaldırmak**

```bash
claude plugin uninstall web-dev@web-dev
claude plugin marketplace remove web-dev
```

**Takım için**: `/web-dev:init` projenin `.claude/settings.json` dosyasına aşağıdaki ayarı yazar. Repoyu klonlayıp klasörü güvenilir olarak işaretleyen herkese marketplace ve plugin otomatik önerilir. Böylece hook'lar, onları açıklayan skill olmadan hiç çalışmaz.

```json
{
  "extraKnownMarketplaces": {
    "web-dev": { "source": { "source": "github", "repo": "hilmierkamgurbuz/web-dev" } }
  },
  "enabledPlugins": { "web-dev@web-dev": true }
}
```

**Yerel kopyadan**: `claude plugin marketplace add /path/to/web-dev`, ardından `claude plugin install web-dev@web-dev`.

## Kullanım

- **Yeni proje:** Uygulamayı anlatın. Skill `procedures/bootstrap.md` akışını izler: ürün soruları, seçenekli stack kararları, blueprint, scaffold, harness kurulumu, ardından ilk feature.
- **Mevcut proje:** Adopt edilmesini isteyin. `procedures/adopt.md` harness'ı kurar, haritaları üretir, notları paralel subagent'larla yazar, blueprint taslağını onayınıza sunar ve bir güvenlik başlangıç raporu çıkarır.

web-dev'i bir projede etkinleştirmek için projede Claude Code'u açın ve şunu çalıştırın:

```text
/web-dev:init
```

Bu komut Node ve git'i kontrol eder, harness'ı kurar (hook'lar, agent'lar, kurallar, config, haritalar ve sabit sürüm parser) ve neyi commit'lemeniz gerektiğini söyler. Bootstrap ve adopt akışları da aynı kurulum script'ini kullanır: `node ${CLAUDE_PLUGIN_ROOT}/scripts/init_project.mjs <proje-kökü> --setup`.

Kurulumdan sonra projede yeni bir Claude Code oturumu açın ve trust diyaloğunu onaylayın. Ardından iki şeyi kontrol edin:
- `/hooks` şu yedi olayı listelemeli: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, SubagentStart, SubagentStop, Stop.
- Oturum başında `[web-dev]` raporu görünmeli.

## Task döngüsü

```
locate + intake → brief → onay → build → verify → close → /clear
```

1. **Locate** — task'in nerede yaşadığını haritalar sabit sırayla cevaplar: index → blueprint → katman haritası → codemap shard → satır aralığıyla okuma. Repo taraması asla ilk adım değildir.
2. **Intake** — birebir istek, kullanıcının teyit ettiği yeniden ifade, ardından `[OPEN]` kalmayana kadar soru turları.
3. **Brief** — `gates/brief.md` formatında `.claude/web-dev/work/task.md`.
4. **Onay** — brief hash'ini içeren tek bir AskUserQuestion; ya da tek başına bir satırda `ONAY`/`APPROVE`. Onayı yalnızca hook kaydeder.
5. **Build** — brief'teki branch'te, yalnızca manifest yollarına yazılır; notlar aynı turda, testler kodla birlikte gelir.
6. **Verify** — `wd verify` (typecheck, lint, test, build), UI değiştiyse `wd responsive`, `wd check` ve reviewer subagent.
7. **Close** — postflight, commit, push, PR. Stop hook'u her şeyi kendi kayıtlarından yeniden doğrular, task'i kapatır ve `/clear` önerir.

## Zorlama

| Hook | Ne yapar |
|---|---|
| SessionStart | Haritaları artımlı üretir ve en fazla 2000 karakterlik rapor enjekte eder: zorlama, parser, git, task, harita sağlığı, araçlar. `/clear` ve compaction sonrasında yeniden çalışır. |
| UserPromptSubmit | Tur kaydını başlatır. Yazılı onay token'ını işler, plan modunu tespit eder. Bu oturumda kapanmış bir task varsa `/clear` önerir. |
| PreToolUse | **Edit/Write:** enforcement dosyaları → default branch → onaylı brief → manifest → sonuç içeriğinin güvenlik, secret, yorum, migration ve bağımlılık taraması. **Bash:** kaynak dosyalara shell ile yazım; git güvenliği (default branch'e commit yok, `--no-verify` yok, default branch'e force push yok, yıkıcı komutlar kullanıcıya sorulur); staged değişikliklerde secret taraması; bağımlılık kapısı; `curl \| sh`. **AskUserQuestion:** önceden doldurulmuş cevapları reddeder. |
| PostToolUse | Yazılan dosya için eksik notları bildirir, onay cevabını kaydeder. Git işlemleri sonrasında haritaları yeniden üretir; paket değişiklikleri sonrasında dokümanları ve bağımlılık uyarılarını kontrol eder; PR adresini kaydeder. |
| SubagentStart | Built-in'ler dahil her agent'a harita sözleşmesini ve güncel harita sağlığını verir. |
| SubagentStop | Reviewer'ın `VERDICT` sonucunu mevcut diff'e bağlayarak kaydeder. |
| Stop | Turda değişen her dosyayı (shell yazımları dahil) yeniden tarar; not borcu varken ya da manifest dışı değişiklik varken turu bloklar. `closing` durumunda şunları doğrular: verify sonucu, testler, responsive kontrolü, `wd check`, review, kalıcı kayıtlar, push edilmiş temiz ağaç ve açık PR. Aynı blok üç kez tekrarlanırsa kullanıcıya mesaja dönüşür. |

Plan modu araç olarak kapatılmıştır, worktree izolasyonlu agent'lar reddedilir. `.claude/agents/Explore.md` devredilen aramaların önce haritalardan yapılmasını sağlar.

### Güvenlik kuralları

`WD-SEC-EVAL` · `WD-SEC-XSS-HTML` · `WD-SEC-SQL-INTERP` · `WD-SEC-CMD-INTERP` · `WD-SEC-TLS-OFF` · `WD-SEC-JWT` · `WD-SEC-CORS` · `WD-SEC-REDIRECT` · `WD-SEC-SSRF` · `WD-SEC-PATH` · `WD-SEC-PROTO` · `WD-SEC-RANDOM` · `WD-SEC-COOKIE` · `WD-SEC-PUBLIC-ENV` · `WD-SEC-SECRET` · `WD-SEC-HASH` · `WD-SEC-POSTMESSAGE` · `WD-SEC-MIGRATION` · `WD-DEP` · `WD-COMMENT`. Harita seviyesinde ayrıca `WD-API-UNAUTH`, `WD-API-UNVALIDATED`, `WD-API-UNMATCHED` ve `WD-DATA-MULTIWRITER` vardır. Ayrıntılar `procedures/security.md` dosyasında.

Bir bulgu yalnızca kullanıcının onayladığı brief'teki `Security exceptions:` satırıyla kabul edilebilir. Kodda susturma yorumu yoktur.

## Haritalar

Haritalar `.claude/web-dev/maps/` altına üretilir; bu klasör gitignore'ludur.

| Harita | Cevapladığı soru |
|---|---|
| `index.md` | feature → shard, giriş dosyaları, route'lar, sayfalar, tablolar, durum |
| `codemap-<shard>.md` | her dosya ve isimli fonksiyon/component/hook: imza, satır aralığı, import'lar, kullananlar, db erişimi, çağrılar, not |
| `apimap.md` | route ↔ handler ↔ auth ↔ input ↔ tablolar ↔ çağıranlar; ayrıca eşleşmeyen, çözülemeyen, ölü, auth'suz ve doğrulanmamış olanlar |
| `uimap.md` | sayfa → layout'lar → component ağacı, client sınırı, veri, metadata, son responsive kontrolü |
| `datamap.md` | tablolar ve in-memory store'lar, bunlara yazan ve okuyanlar; env yüzeyi ve bulgular |

AI'ın yazdığı tek kısım notlardır. `.claude/web-dev/notes/<shard>.md` altında durur, commit'lenir ve `wd note set` ile yazılır. Anahtara göre sıralı tutulduğu için paralel branch'lerde nadiren conflict çıkar.

## `wd` — harness CLI

Proje kökünden `node .claude/hooks/web-dev/wd.mjs <komut>` şeklinde çalıştırılır.

| Komut | Amaç |
|---|---|
| `maps [--force]` | haritaları üret |
| `note set` / `note missing` | JSON satırlarından not yaz / eksik notları listele |
| `task hash` / `task status` | onay için brief hash'i / durum |
| `check [--draft-blueprint]` | blueprint, harita ve doküman tutarlılığı |
| `verify` | typecheck, lint, test, build; sonuç Stop hook'u için kaydedilir |
| `responsive [--path /x]` | ekran görüntülü Playwright viewport ve erişilebilirlik kontrolü |
| `scan <dosyalar>` / `scan --all --report` | güvenlik taraması |
| `review-prep` | reviewer için diff ve bağlam |
| `pr-body` | brief ve sonuçlardan PR açıklaması |
| `facts check` / `id D\|R` / `setup` | bayat fact'ler, sıradaki id, parser kurulumu |

## Proje dosyaları

| Commit'lenen | Gitignore'lu |
|---|---|
| `CLAUDE.md` (`.claude/web-dev/CLAUDE.md`'yi import eder), `.claude/settings.json`, `.claude/hooks/web-dev/`, `.claude/agents/`, `.claude/rules/web-dev-*.md`, `.claude/web-dev/{product,stack,decisions,blueprint}.md`, `notes/`, `facts/`, `config.json`, `shards.json`, `enforce.json` | `.claude/web-dev/{maps,state,work,shots}/` |

- `product.md` kalıcı istekleri (`R-###`) tutar.
- `stack.md` ve `decisions.md` kararları (`D-###`) tutar; `wd check` bunları `package.json` ve lockfile ile karşılaştırır.
- `facts/<paket>@<sürüm>.md` sürüme bağlı, damıtılmış framework bilgisidir; lockfile değişince bayat olarak işaretlenir.
- Task brief'i ve postflight task kapanınca silinir; içerikleri PR'da yaşamaya devam eder.

## Yapılandırma

`.claude/web-dev/config.json` şunları içerir:
- `defaultBranch`, `git.remote` (yalnızca yerel çalışma için `none`), `git.pullRequest`
- `commands.{typecheck,lint,test,build,dev}`, `devUrl`
- `responsive.{viewports,paths,minTapTargetPx,minFontPx}`
- `generated` glob'ları, `authMarkers`, `validationMarkers`
- `approval.{labels,tokens}`, `comments.allowedPragmas`
- `security.{gitleaks,opengrep,osvScanner}` (`auto`/`off`)

Bu dosyayı bir brief üzerinden değiştirin: kapı bu dosyayı okur.

## Plugin geliştirme

```bash
WEB_DEV_CACHE=/tmp/wd-cache node -e "import('./scripts/lib/ts.mjs').then(m => m.installParser())"
WEB_DEV_CACHE=/tmp/wd-cache node --test tests/
```

Parser sürümü sabittir: `typescript@6.0.3`, yani JavaScript compiler API'sine sahip son sürüm. Kullanıcı başına bir önbellekte durur; bu sayede proje TypeScript'i yükseltse bile harita hash'leri değişmez. `tests/fixtures/` şu projeleri kapsar: Next.js + Prisma, Vite React + Express + Drizzle monorepo, Nuxt ve tRPC'li SvelteKit.

## Bilinen sınırlar

- Shell ile yazım kontrolü tam bir shell parser'ı değil, heuristiktir. Kaçırdığı yazımları Stop hook'unun tur sonu taraması yakalar, ama tur içinde kısa bir pencere kalır.
- Mantık seviyesindeki zafiyetler (yanlış yetki kuralı, iş kuralı hatası gibi) desenle yakalanamaz. Brief'in risk bölümü, güvenlik kontrol listesi ve reviewer bunları azaltır; olmadıklarını kanıtlamaz.
- Tanınmayan routing veya client desenleri `## Unresolved` bölümüne düşer: görünürler ama bağlanmazlar.
- Hook'lar kapalıysa (`disableAllHooks`) ya da workspace güvenilir değilse hiçbir kapı çalışmaz. İşaret, `[web-dev]` raporunun görünmemesidir; skill bu rapor olmadan kod yazmaz.

## Lisans

MIT
