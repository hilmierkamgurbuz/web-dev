# web-dev

Web geliştirmeyi bir sohbet değil, bir koşum takımı hâline getiren Claude Code eklentisi.
Model değişmiyor; değişen şey modelin neyi gördüğü, neyi yazmasına izin verildiği ve neyin
"bitti" sayıldığı.

Bir kez kurulur ve makinedeki her dizinde çalışır — projeye yeni başlayacağınız boş klasör dahil.

[English](README.md)

## Ne sağlar

- **Kendi kendine devreye girer.** Eklenti kendi hook'larını taşır; bu yüzden açtığınız her
  dizine bakar: site istediğiniz boş bir klasöre, beş yıllık bir Next.js deposuna ya da uzak
  durması gereken bir Python projesine. İlk kapı ile sizin aranızda proje başına bir kurulum
  adımı yoktur.
- **Koddan önce soru.** Sizin sözlerinizde ya da proje dosyalarında olmayan her şey, tahmin
  değil, seçenekleri ve bedelleriyle birlikte bir soru olur. Bir hook sorulan her soruyu
  kaydeder; vermediğiniz bir cevabı iddia eden brief onaylanamaz.
- **Plan modu yerine brief.** Görevi tek bir onaylı dosya tanımlar: amaç, kararlar, kabul
  kriterleri, yazılabilecek tam dosya listesi ve dal. Onay, o dosyanın hash'ine bağlıdır —
  dosyayı değiştirirseniz onay düşer.
- **Ölçeklenen tören.** Tek satırlık bir CSS düzeltmesi, şema göçünün sürecini ödemez. Üç sınıf
  (`touch`, `task`, `arch`) döngünün ne kadarının işleyeceğine karar verir.
- **Tutan kapılar.** Manifest, güvenlik, yorum, varsayılan dal ve bağımlılık kuralları
  `PreToolUse`'ta uygulanır: bu hook her izin modunda, `bypassPermissions` dahil, izin
  kontrolünden önce çalışır. Kaynak ağacındaki bir izleyici, hiçbir araçtan geçmeyen yazmaları
  da görür: `sed -i`, `>`, `tee`, bir üretici ya da kendi editörünüz.
- **Yalan söylemeyen haritalar.** Kod, API, UI ve veri haritaları koddan üretilir ve sembol
  başına notlarla birleşir. Gövdesi değişmiş bir notun sembolü `STALE` işaretlenir; işaret
  satırı silerek değil, onararak temizlenir.
- **Küçük kalan bağlam.** Her şey diskte durur, bu yüzden görevler arasındaki `/clear` hiçbir
  şey kaybettirmez. Sonraki oturum kendi durumunu geri okur ve ertelediğiniz işler varsa
  sormadan önünüze getirir.

## Gereksinimler

| | |
|---|---|
| Node | 20 veya üzeri |
| git | güncel bir sürüm |
| Claude Code | 2.1.200 veya üzeri |
| İşletim sistemi | macOS, Linux, Windows |
| İsteğe bağlı | PR için `gh` · responsive kontrol için `@playwright/test` · derin tarama için `gitleaks`, `opengrep`, `osv-scanner` |

## Kurulum

```bash
claude plugin marketplace add hilmierkamgurbuz/web-dev
claude plugin install web-dev@web-dev
```

Kurulumun tamamı budur. Hook'lar bir sonraki oturumda her yerde çalışır.

Ardından, makine başına bir kez, haritaların kurulduğu sabitlenmiş TypeScript ayrıştırıcısını
kurun:

```bash
claude   # herhangi bir projede
> /web-dev:init
```

### Var olan bir projeyi devralmak

Claude Code'u depoda açın ve ne yapmak istediğinizi söyleyin. Koşum takımı, durumu olmayan bir
JavaScript/TypeScript projesi gördüğünü anlar ve sizi devralma akışına sokar: yığını tespit
eder, haritaları kurar, planı tersine mühendislikle çıkarır, ürün ve yığın kayıtlarını
onaylatır ve hepsini tek bir pull request olarak teslim eder.

Yeni proje için Claude Code'u boş bir dizinde açıp uygulamayı anlatın. Önce intake, sonra yığın
kararları, sonra iskelet.

## Kullanım

Ne istediğinizi söyleyin; hatırlanacak bir komut yok.

```
bir fırın için iletişim formu olan bir tanıtım sayfası yap
sepete Stripe ödemesi ekle
son kurulumdan sonra build bozuldu
kaldığımız yerden devam et
```

| Komut | Yapar |
|---|---|
| `/web-dev:init` | mevcut depoda proje durumunu kurar ya da tazeler |

## Görev döngüsü

```
locate → intake → brief → onay → build → doğrulama → kapanış → /clear
```

| Adım | Ne olur |
|---|---|
| locate | Görevin nerede yaşadığını haritalar söyler. `wd map <yol>` tüm shard'ı değil, tek dosyanın kaydını döner. |
| intake | İsteğiniz birebir saklanır, size geri anlatılır ve sonucu değiştirecek her belirsizlik seçenekli bir soruya dönüşür. |
| brief | `.claude/web-dev/work/task.md`: amaç, kararlar, kabul kriterleri, tasarım, risk, doğrulama, dal, manifest. |
| onay | Kararları ve dosya listesini görür, brief'in hash'ini taşıyan tek bir soruyu onaylarsınız. |
| build | Yalnızca manifest yolları, yalnızca Edit/Write ile, görev dalında, notlar aynı turda. |
| doğrulama | `wd verify` tip kontrolü, lint, test ve build çalıştırır. UI değiştiyse `wd responsive` her viewport'ta koşar. |
| kapanış | Postflight, commit, push, PR. Stop hook'u her şeyi yeniden kontrol eder ve ancak ondan sonra görevi kapalı ilan eder. |
| /clear | Durum diskte. Temizleyin; sonraki oturum kaldığı yerden devam eder. |

`touch` görevleri intake'i, brief'i ve PR törenini atlar. `arch` görevleri zorunlu bir soru turu
ve temiz bağlamlı bir inceleme ekler.

## Zorlama katmanı

Eklentiyle gelen iki halka.

**Halka 0** her dizinde çalışır: `SessionStart`, `UserPromptSubmit`, `CwdChanged`, `PreCompact` ve
`PreToolUse`'un yazma yarısı buranın web-dev alanı olup olmadığına karar verir. Devralınmamış bir
dizinde yalnızca bakar ve yönlendirir; yapabildiği tek şey, web kaynağına ilk yazmadan önce
*sormaktır*. Bir Python deposunda hiçbir şey söylemez ve hiçbir şeye mal olmaz (45 ms süreç, sıfır
token). Devralınmış bir projede aynı `SessionStart` haritaları ve `wd` shim'ini de tazeler.

**Halka 1** `.claude/web-dev/` varsa devreye girer, yoksa milisaniyeler içinde geri döner:

| Hook | Yapar |
|---|---|
| `PreToolUse` | manifest dışı yazmaları, açık veren kalıpları, eklenen yorumları, bildirilmemiş bağımlılıkları, yıkıcı göçleri, varsayılan dala commit'i, stdin'den program yiyen yorumlayıcıları ve proje kökü dışına yazmayı engeller |
| `PostToolUse` | yazmaları, onayları ve soru defterini kaydeder |
| `PostToolBatch` | grup başına tek harita render'ı ve hâlâ borçlu olunan notlar |
| `FileChanged` | hiçbir aracın yapmadığı değişiklikler dahil, dosya sistemindeki her değişikliği görür |
| `PermissionRequest` | yalnızca koşum takımının kendi komutlarını sessizce onaylar |
| `PostToolUseFailure` | sık görülen bir araç hatasını, onu çözen tek adıma çevirir |
| `SubagentStart` | her alt ajana harita sırasını ve güncel sağlığı verir |
| `SubagentStop` | inceleyicinin kararını, incelediği diff'e bağlı olarak kaydeder |
| `Stop` | kapanış denetimi: doğrulama, testler, responsive, inceleme, kayıtlar, PR — her biri kod değişince geçersizleşen bir hash'e bağlı |
| `PreCompact` | brief'i, manifest'i ve locate sonucunu sıkıştırma özetine sabitler |
| `ConfigChange` | neyin zorlandığına karar veren dosyaların görev ortasında değişmesini reddeder |
| `SessionEnd` | görev durumunu kaydeder |

Bozulan kapı, kapatan kapıdır: hook'un kendisi hata verirse çağrı kontrolsüz geçmez, reddedilir.

### Güvenlik

Zorlanan kurallar taint tabanlıdır: biçime değil, kullanıcının kontrol ettiği verinin tehlikeli
bir noktaya ulaşmasına bakar. Enjeksiyon, XSS noktaları, yol aşımı, SSRF, prototype pollution,
açık yönlendirme, zayıf kripto, JWT `none`, kapalı TLS, credentials'lı CORS, güvensiz çerezler,
istemciye sızan sırlar ve gömülü kimlik bilgileri yazma anında engellenir.

Hiçbir kalıbın karar veremeyeceği şeyler — yetkilendirme, iş mantığı, CSRF, hız sınırı, CSP,
sessizce yutulan hata yolları — brief'in muhakeme listesinde ve inceleme turunda durur. Temiz
bir tarama tavan değil tabandır ve koşum takımı bunu aksini ima etmek yerine açıkça söyler.

## Haritalar

`.claude/web-dev/maps/` altına üretilir, gitignore'dadır, istendiğinde yeniden kurulur. Koddan
çıkarılan mekanik olgularla, sizin ve modelin yazdığı ve commit'lenen notları birleştirir.

| Harita | Neyi cevaplar |
|---|---|
| `index.md` | özellik → shard'lar, giriş dosyaları, rotalar, sayfalar, tablolar, durum |
| `codemap-<shard>.md` | her adlandırılmış sembol: imza, satır aralığı, import'lar, kim çağırıyor, db erişimi, çağrılar, not |
| `apimap.md` | rota ↔ handler ↔ auth ↔ girdi şeması ↔ çıktı ↔ tablolar ↔ frontend çağıranlar |
| `uimap.md` | rota → layout → bileşen ağacı, istemci/sunucu sınırı, veri çekme |
| `datamap.md` | tablolar, ilişkiler, okuyanlar ve yazanlar, tek-yazan kontrolü, env yüzeyi |

Gerçek bir kod tabanında haritalar, anlattıkları kaynağın yaklaşık onda biri kadar yer tutar.
Bir shard'ı açmak yerine `wd map <yol>` veya `wd find <sembol>` ile okuyun.

## `wd` — koşum takımı CLI'ı

Proje kökünden `node .claude/web-dev/wd.mjs <komut>` ile çalıştırılır.

| Komut | Yapar |
|---|---|
| `map <yol>` / `find <sembol>` | tek dosyanın ya da tek sembolün harita satırları |
| `class` | locate sonucundan görev sınıfı |
| `defer "<madde>"` | kapsam dışı bir işi `/clear` sonrası için kuyruğa alır |
| `config set <anahtar> <değer>` | `config.json`'ın zaten tanımladığı tek bir anahtarı değiştirir; kapı bu dosyayı okuduğu için elle düzenlenmez |
| `maps` | bütün haritaları yeniden üretir |
| `note set` / `note missing` | stdin JSON'undan not yazar / borçlu olunanları listeler |
| `task hash` / `task status` | brief hash'i / durum makinesindeki konum |
| `check` | blueprint ↔ disk ↔ haritalar, dokümanlar ↔ paket sürümleri |
| `verify` | tip kontrolü, lint, test, build |
| `responsive` | her viewport'ta kontrol, ekran görüntüleriyle |
| `scan` | güvenlik, sır ve yorum taraması |
| `review-prep` / `pr-body` | inceleyicinin diff'i / PR gövdesi |
| `id D` / `id R` | sıradaki boş karar veya gereksinim id'si |
| `facts check` | sabitlenmiş sürümü lockfile ile uyuşmayan olgular |
| `setup` | bu makine için sabitlenmiş ayrıştırıcıyı kurar |

## Yapılandırma

`.claude/web-dev/config.json` varsayılan dalı, paket yöneticisini, doğrulama komutlarını,
responsive viewport'ları, haritanın tanıdığı auth ve doğrulama işaretçilerini, onay etiketlerini
ve token'larını, izin verilen yorum pragmalarını ve hangi isteğe bağlı güvenlik araçlarının
kullanılacağını tutar. `.claude/web-dev/shards.json` yol desenlerini codemap shard'larına eşler ve
bir shard'ın boyutunu sınırlar. İkisi de brief üzerinden değil, yalnızca sizin tarafınızdan
(veya `wd config set` ile) değişir.

## Proje dosyaları

| Commit'lenen | Üretilen |
|---|---|
| `CLAUDE.md`, `.claude/settings.json`, `.claude/agents/`, `.claude/rules/web-dev-*.md`, `.claude/web-dev/{product,stack,decisions,blueprint}.md`, `notes/`, `facts/`, `config.json`, `enforce.json`, `shards.json` | `.claude/web-dev/{maps,state,work,shots}/`, `wd.mjs`, `statusline.mjs` |

`enforce.json` kapıyı her klonda kuran dosyadır. `config.json` kapının neyi zorladığına karar
verir; bu yüzden ikisi de brief üzerinden değiştirilemez, yalnızca siz değiştirirsiniz.

## Eklentiyi geliştirme

```bash
npm run setup   # sabitlenmiş ayrıştırıcıyı kullanıcı önbelleğine kurar
npm test        # node:test — kapı, güvenlik, haritalar, notlar, durum, kablolama
```

`npm test` düşmanca bir takım içerir: denetimin bulduğu her atlatma yolunun onu deneyen bir
testi vardır ve bir kablolama testi, her hook yolunun, yer tutucunun ve yönlendirilen dosyanın
gerçekten diskte çözüldüğünü doğrular.

## Bilinen sınırlar

- Koşum takımı sizin yerinize `/clear` çalıştıramaz — hiçbir hook çalıştıramaz. Yaptığı şey,
  temizlemeyi bedelsiz kılmak, zamanı geldiğini söylemek ve öbür tarafta işi kaldığı yerden
  almaktır.
- `wd responsive` projede `@playwright/test` ister.
- Derin tarama `gitleaks`, `opengrep` veya `osv-scanner` kurulu değilse sessizdir.
- Statik analiz yetkilendirme ve iş mantığı hatalarını göremez. Muhakeme listesi ve inceleme
  tam olarak bunun içindir.

## Lisans

MIT
