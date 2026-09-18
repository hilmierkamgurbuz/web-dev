# web-dev

Web geliştirmeyi bir sohbet değil, bir koşum takımı hâline getiren Claude Code eklentisi.
Model değişmiyor; değişen şey modelin neyi gördüğü, neyi yazmasına izin verildiği ve neyin "bitti"
sayıldığı.

Bir kez kurulur ve makinedeki her dizinde çalışır — projeye yeni başlayacağınız boş klasör dahil.

[English](README.md)

---

## İçindekiler

- [Neden var](#neden-var)
- [Ne sağlar](#ne-sağlar)
- [Gereksinimler](#gereksinimler)
- [Kurulum](#kurulum)
- [İlk beş dakika](#ilk-beş-dakika)
- [Görev döngüsü](#görev-döngüsü)
- [Görev sınıfları](#görev-sınıfları)
- [Brief](#brief)
- [Zorlama katmanı](#zorlama-katmanı)
- [Güvenlik](#güvenlik)
- [Haritalar](#haritalar)
- [Notlar](#notlar)
- [`wd` — koşum takımı CLI'ı](#wd--koşum-takımı-clıı)
- [Yapılandırma](#yapılandırma)
- [Proje dosyaları](#proje-dosyaları)
- [Alt ajanlar](#alt-ajanlar)
- [Bağlam ve `/clear`](#bağlam-ve-clear)
- [Token maliyeti](#token-maliyeti)
- [Sorun giderme](#sorun-giderme)
- [Kaldırma](#kaldırma)
- [Eklentiyi geliştirme](#eklentiyi-geliştirme)
- [Tasarım notları](#tasarım-notları)
- [Bilinen sınırlar](#bilinen-sınırlar)
- [Lisans](#lisans)

---

## Neden var

Web kodu yazan bir LLM, sayılı ve tanıdık biçimlerde hata yapar. Sormak yerine gereksinimi tahmin
eder. Kendisinden istenmemiş bir dosyayı düzenler. Yazdığı açıklama iki commit sonra doğru olmaktan
çıkar. Hiçbir şey çalıştırmadan "bitti" der. Bağlam penceresinin yarısını zaten okuduğu kaynağı
yeniden okumaya harcar.

Bunların hiçbiri daha iyi bir prompt'la çözülmez, çünkü prompt bir tavsiyedir ve tavsiye
atlanabilir. Bunlar, modelin içinde çalıştığı ortamı değiştirerek çözülür: önünde ne duruyor,
araçlar gerçekten neye izin veriyor, ve bir görev kapanmadan önce diskte neyin doğru olması
gerekiyor.

Bu eklenti tam olarak budur. Aşağıdaki her kural bir hook tarafından uygulanır, düz metinle rica
edilmez — ve bir kural gerçekten uygulanamıyorsa, dokümantasyon aksini ima etmek yerine bunu
açıkça söyler.

---

## Ne sağlar

**Kendi kendine devreye girer.** Eklenti kendi hook'larını taşır; bu yüzden açtığınız her dizine
bakar: site istediğiniz boş bir klasöre, beş yıllık bir Next.js deposuna ya da uzak durması gereken
bir Python projesine. İlk kapı ile sizin aranızda proje başına bir kurulum adımı yoktur.

**Koddan önce soru.** Sizin sözlerinizde ya da proje dosyalarında olmayan her şey, tahmin değil,
seçenekleri ve bedelleriyle birlikte bir soru olur. Bir hook gerçekten sorulan her soruyu kaydeder;
vermediğiniz bir cevabı iddia eden brief onaylanamaz.

**Plan modu yerine brief.** Görevi tek bir onaylı dosya tanımlar: amaç, kararlar, kabul kriterleri,
yazılabilecek tam dosya listesi ve dal. Onay o dosyanın hash'ine bağlıdır — dosyayı değiştirirseniz
onay düşer.

**Ölçeklenen tören.** Tek satırlık bir CSS düzeltmesi, şema göçünün sürecini ödemez. Üç sınıf
(`touch`, `task`, `arch`) döngünün ne kadarının işleyeceğine karar verir.

**Tutan kapılar.** Manifest, güvenlik, yorum, varsayılan dal ve bağımlılık kuralları `PreToolUse`'ta
uygulanır: bu hook her izin modunda, `bypassPermissions` dahil, izin kontrolünden önce çalışır.
Kaynak ağacındaki bir izleyici, hiçbir araçtan geçmeyen yazmaları da görür: `sed -i`, `>`, `tee`,
bir üretici ya da kendi editörünüz.

**Yalan söylemeyen haritalar.** Kod, API, UI ve veri haritaları koddan üretilir ve sembol başına
notlarla birleşir. Gövdesi değişmiş bir notun sembolü `STALE` işaretlenir; işaret satırı silerek
değil, onararak temizlenir.

**Küçük kalan bağlam.** Her şey diskte durur, bu yüzden görevler arasındaki `/clear` hiçbir şey
kaybettirmez. Sonraki oturum kendi durumunu geri okur ve ertelediğiniz işler varsa sormadan önünüze
getirir.

---

## Gereksinimler

| | | |
|---|---|---|
| **Node** | 20 veya üzeri | hook'lar ve CLI bağımlılıksız ESM |
| **git** | güncel bir sürüm | görev döngüsü dal tabanlı |
| **Claude Code** | 2.1.200 veya üzeri | önceki sürümlerde `FileChanged` ve `PostToolBatch` yok |
| **İşletim sistemi** | macOS, Linux, Windows | Windows'ta kapı PowerShell yazmalarını reddeder; Edit/Write kullanın |

İsteğe bağlı, yokken sessiz:

| Araç | Ne kazandırır | Kurulum |
|---|---|---|
| `gh` | PR açma ve kapanıştaki PR kontrolü | `brew install gh` |
| `@playwright/test` | `wd responsive` — gerçek viewport, gerçek ekran görüntüsü | proje devDependency + `npx playwright install chromium` |
| `@axe-core/playwright` | responsive koşusunun içinde erişilebilirlik bulguları | proje devDependency |
| `gitleaks` | sırlar için ikinci görüş, staged olanlar dahil | `brew install gitleaks` |
| `opengrep` (veya `semgrep`) | görev kapanışında dokuz ek taint kuralı | [opengrep releases](https://github.com/opengrep/opengrep/releases) |
| `osv-scanner` | bağımlılık değişiminden sonra lockfile'daki bilinen CVE'ler | `brew install osv-scanner` |

Her isteğe bağlı araç görünür şekilde bozulur: sağlık satırı, üretmediği temiz bir sonucu rapor
etmek yerine aracın eksik olduğunu söyler.

---

## Kurulum

```bash
claude plugin marketplace add hilmierkamgurbuz/web-dev
claude plugin install web-dev@web-dev
```

Kurulumun tamamı budur. Hook'lar bir sonraki oturumda, her dizinde çalışır.

Ardından, makine başına bir kez, haritaların kurulduğu sabitlenmiş TypeScript ayrıştırıcısını
kurun:

```bash
claude            # herhangi bir projede
> /web-dev:init
```

`/web-dev:init` aynı zamanda [Proje dosyaları](#proje-dosyaları) bölümündeki proje durumunu yazar.
`--setup` bayrağı, ayrıştırıcı bu makinede yoksa kurar.

Claude Code olmadan doğrudan çalıştırmak:

```bash
node ~/.claude/plugins/cache/web-dev/web-dev/*/scripts/init_project.mjs . --setup
```

Ayrıştırıcı `typescript@6.0.3`'e sabitlenmiştir ve makine başına önbelleklenir, çünkü TypeScript 7
çıkarıcının dayandığı JavaScript derleyici API'sini kaldırdı.

---

## İlk beş dakika

### Sıfırdan yeni proje

Claude Code'u boş bir dizinde açın ve uygulamayı anlatın:

```
bir fırın için tanıtım sayfası yap, iletişim formu olsun
```

Sırayla ne olur:

1. `SessionStart` boş dizini görür ve modele bu görevin bu koşum takımına ait olduğunu söyler.
2. Model skill'i yükler ve `procedures/bootstrap.md`'yi izler.
3. **Intake** — amaç, kullanıcılar, temel akışlar, cihazlar, erişilebilirlik hedefi, diller, auth,
   kişisel veri, veri boyutları, entegrasyonlar, performans bütçesi ve hosting sorulur. Henüz
   hiçbir iskelet kurulmaz.
4. **`product.md`** cevaplarınızdan yazılır, her gereksinim bir `R-###` id taşır.
5. **Yığın kararları**, teker teker, her biri seçenekleri ve sonuçlarıyla, her biri `stack.md`'de
   bir `D-###` olarak kaydedilir.
6. **`blueprint.md`** — özellikler, tek yönlü okları, rota/sayfa/tablo envanteri ve klasör düzeni.
7. `git init`, sonra framework'ün resmî CLI'ı iskeleti kurar. O commit **baseline**'dır: yorum ve
   kalıp kuralları ondan sonrasına uygulanır, üreticinin çıktısına asla.
8. Koşum takımı proje durumunu kurar ve haritalar ilk kez üretilir.
9. İlk özellik normal görev döngüsünü izler.

### Var olan proje

Claude Code'u depoda açın ve ne değiştirmek istediğinizi söyleyin. Koşum takımı, durumu olmayan bir
JavaScript/TypeScript projesi görür ve sizi `procedures/adopt.md`'ye sokar:

1. Bir dal, `chore/web-dev-adopt` — devralma da her görev gibi PR olarak teslim edilir.
2. Yığın tespiti: framework'ler, paket yöneticisi, workspace'ler, typecheck/lint/test/build/dev
   script'leri, test koşucusu, ORM, auth kütüphaneleri, Playwright.
3. Tespitin bulamadığı her şey sorulur ve `wd config set` ile kaydedilir.
4. `wd maps` mekanik haritaları kurar.
5. Not kapsamını siz seçersiniz: şimdi her sembol, ya da önce çekirdek ve API/veri katmanı. Notu
   olmayan semboller `MISSING` işaretlenir; bu normaldir ve asla engellemez.
6. Shard başına `web-dev-annotator` alt ajanları notları yazar — her seferinde tek shard, böylece
   hiçbir bağlam tüm kod tabanını taşımaz.
7. `wd check --draft-blueprint` rotalardan, sayfalardan ve tablolardan özellikler önerir; sınırları
   siz onaylarsınız; `blueprint.md` yazılır.
8. `product.md` ve `stack.md` koddan önerilir ve sizin tarafınızdan onaylanır.
9. `wd scan --all --report` güvenlik taban çizgisini verir. Mevcut bulgular engellemez — kapı
   bundan sonra yazılan koda uygulanır.
10. Postflight, commit, push, PR.

### Sonrası, her gün

Ne istediğinizi söyleyin. Hatırlanacak bir komut yok.

```
sepete Stripe ödemesi ekle
son kurulumdan sonra build bozuldu
fiyat tablosu telefonda okunmuyor, düzelt
kaldığımız yerden devam et
```

---

## Görev döngüsü

```
locate → intake → brief → onay → build → doğrulama → kapanış → /clear
```

### 0 · locate

Görevin nerede yaşadığı haritalardan, sabit bir sırayla, cevap veren ilk adımda durularak bulunur:

1. `maps/index.md` — özellik satırı: shard'lar, giriş dosyaları, rotalar, sayfalar, tablolar, durum.
2. `blueprint.md` — özellik, okları, klasör düzeni. Yeni işin nereye takılacağına bu karar verir.
3. İlgili tek katman haritası — `apimap.md`, `uimap.md` veya `datamap.md`.
4. `wd map <yol>` — tek dosyanın kaydı. Tüm shard yalnızca görev gerçekten onu kapsıyorsa açılır.
5. Sembolün `L` aralığından `offset`/`limit` ile `Read` — sadece değişimin ihtiyaç duyduğu semboller.
6. Grep/Glob, en son çare, yukarıdaki adımların daralttığı dizinlerin içinde.

Sonuç `work/locate.md`'ye yazılır, böylece sıkıştırmadan sağ çıkar. 4. adımdan önce depo geneli bir
arama prosedür ihlalidir; devredilen arama da aramadır: postflight, alt ajanın hangi adımda
durduğunu bildirir.

### 0 · intake

İsteğiniz **birebir** saklanır. Model ne anladığını geri yazar — amaç, kapsam içi, kapsam dışı, ne
görünür şekilde değişecek, hangi mevcut davranış bozulabilir — ve onaylamanızı ister.

Sonra belirsizlikleri listeler. Bir şey ancak cevabı şunlardan en az birini değiştiriyorsa
belirsizliktir: veri şekli veya depolama, kimin neyi yapabildiği, kullanıcının ne gördüğü ya da
yaptığı, API sözleşmesi, render modu, bağımlılıklar veya maliyet, kabul kriterleri. Gerisi alışılmış
seçeneği alır ve bunu söyler.

Sorular en fazla dörtlü turlar hâlinde gelir, geri dönülemezler önce, her biri iki–dört somut
seçenekle; önerilen önce gelir ve her seçenek `+ fayda · − bedel` taşır.

Şunlar asla sessizce kararlaştırılmaz: veri modeli değişiklikleri, kimlik doğrulama ve yetkilendirme,
render modu, hosting, ödemeler, kişisel veri (KVKK/GDPR), yıkıcı göçler, yeni bağımlılıklar ve
lansmanda geri alınamaz ya da kullanıcıya görünür olan her şey.

### 1 · brief

`.claude/web-dev/work/task.md` — tam biçim için [Brief](#brief).

### 2 · onay

Size şunlar gösterilir: amaç, kabul kriterleri, **`## Decisions` bölümünün tamamı birebir**,
manifest `new`/`edit` işaretli bir yol listesi olarak, ayrıca bağımlılıklar, güvenlik istisnaları,
göçler ve dal. Sonra tek bir soru:

```
Sipariş notunu 500 karakterle sınırlayıp kaydediyoruz. [web-dev brief a3f91c02]
  ▸ Onayla        ▸ Revise
```

Onayı yalnızca hook kaydeder ve brief'in hash'ine artı kararların özetine bağlar. Sonradan brief'i
düzenlemek onayı düşürür. `AskUserQuestion` yoksa tek başına bir satırda `ONAY a3f91c02` gönderin —
çıplak `ONAY` reddedilir, çünkü onay hangi sürümü onayladığını söylemek zorundadır.

### 3 · build

Brief'teki dal. Yalnızca manifest yolları. Yalnızca Edit/Write. Notlar aynı turda. Davranışla
birlikte testler.

### 4 · doğrulama

`wd verify` `config.json`'daki typecheck, lint, test ve build'i çalıştırır ve sonucu ağacın hash'ine
karşı kaydeder. UI değiştiyse `wd responsive` her viewport'ta koşar. `wd check` blueprint, disk ve
haritaları uzlaştırır. `arch` görevleri inceleyici alt ajanı ekler.

### 5 · kapanış

`work/postflight.md`, commit, push, `wd pr-body` ile PR. Stop hook'u makineyle kontrol edilebilir
her maddeyi **sizin raporunuzdan değil, kendi kayıtlarından** yeniden doğrular ve ancak ondan sonra
görevi kapalı işaretler.

Postflight yazmak o denetimi başlatan şey değildir. Denetim, dal commit taşıyorken tur "iş bitti"
diyerek sona erdiğinde de devreye girer — yani "bitti" demek de aynı kapıdan geçer.

### 6 · clear

PR bağlantısını, kabul kriteri başına bir satırı ve `/clear` önerisini alırsınız. `wd defer` ile
kuyruğa aldığınız her şey bir sonraki oturumun başında önünüze gelir.

---

## Görev sınıfları

`wd class` locate sonucunu okur ve sınıfı yazar. Döngünün ne kadarının işleyeceğine o karar verir.

| Sınıf | Ne zaman | Döngü |
|---|---|---|
| `touch` | tek dosya, dışa açık sembol / rota / tablo / env değişimi yok, bağımlılık yok, auth-ödeme-göç yolu değil | locate → değişiklik → notlar → `wd verify` → commit |
| `task` | diğer her şey | yukarıdaki tam döngü |
| `arch` | şema veya auth değişimi, yeni bağımlılık, yıkıcı göç, yeni rota sözleşmesi, tüm uygulamanın üzerinden render olduğu bir dosya, ya da üç ayrı alana yayılan değişim | tam döngü **artı** zorunlu bir soru turu ve inceleyici alt ajan |

Sınıflandırıcı yalnızca yapılandırılmış alanları okur — yazılan yollar, `Contracts touched`,
brief'in manifest'i ve göçleri — locate bloğunun serbest metin kısımlarını asla; böylece bir
cümlede geçen "checkout" kelimesi bir yazım düzeltmesini yükseltmez. `auth/` klasörü altındaki bir
stil dosyası `touch` kalır.

Üst sınıfı zorlamak için locate bloğuna `- Arch signal: <gerekçe>` ekleyin. Sınıfını aşan bir
`touch` anında yeniden sınıflanır ve daha dolu döngüyü intake'ten itibaren alır.

---

## Brief

```markdown
# Brief: Add order note

## Request (verbatim)
> siparişe not alanı ekle

## Understanding
- Goal: a buyer can store a short note on an order
- In scope: note service function and its test
- Out of scope: UI
- Located: step 4 · feature: orders
- Attachment point: src/features/orders

## Decisions
- Q: maximum length? → A: 500 characters · by: user
- Q: who may edit it? → A: the buyer, until the order ships · by: user · → durable R-011

## Acceptance
- [ ] a note of up to 500 characters is saved

## Design
- Data source: existing orders table, new column
- Render boundary: -
- API contract: PATCH /api/orders/{} · in: NoteSchema · out: Order · auth: session · 404/422
- Ownership: orders.service is the single writer
- Cost: per request, ×1 — one indexed update

## Risk
- Security: length validated server-side; buyer ownership checked at the service
- Security exceptions: -
- Migrations: add nullable column, no data loss
- Dependencies: -
- Assumptions: -

## Verification
- Tests: src/features/orders/note.test.ts — length cap, ownership
- Responsive: -
- Map repairs: -

## Git
- Branch: feat/order-note

## Durable
- R-011

## Manifest
- src/features/orders/note.ts
- src/features/orders/note.test.ts
```

Hook'un uyguladığı kurallar:

- `## Manifest` tam yolları tutar, glob yok. Tek istisna bir kod üreticisinin çıktısını kapsayan
  `generated:` satırlarıdır.
- Manifest'te asla bir `.claude/` yolu olamaz. Neyin zorlandığına karar veren dosyaları siz
  değiştirirsiniz, ya da `wd config set` ile.
- Her `[OPEN]` onaydan önce çözülür. Devrettiğiniz karar `by: delegated` yazılır.
- `by: user` kararı, kaydedilmiş bir soruyla **ve gerçekten seçtiğiniz seçenekle** eşleşmek zorunda.
- `Tests: none` açık onayınızı gerektirir ve `## Decisions`'a kaydedilir.
- `Dependencies:` içinde olmayan paket kurulamaz; `Migrations:` içinde olmayan yıkıcı göç yazılamaz.
- Güvenlik bulgusu yalnızca `Security exceptions:` ile kabul edilir, asla kod yorumuyla.

---

## Zorlama katmanı

İki halka, ikisi de eklentinin içinde gelir. Projenizin ayarlarına hiçbir şey kaydedilmez.

### Halka 0 — her dizinde çalışır

| Hook | Ne yapar |
|---|---|
| `SessionStart` | dizini sınıflar (armed / web / empty / other), sağlık satırını yazar, izleme listesini kaydeder, `wd` shim'ini tazeler ve `/clear` sonrası sıradaki görevi açar |
| `UserPromptSubmit` | onay token'ını kaydeder, plan modunu uyarır, devralınmamış bir web projesinde rotayı söyler — her prompt'ta değil, oturumda bir kez |
| `CwdChanged` | başka bir projeye `cd` ettiğinizde izleme listesini yeniden kaydeder |
| `PreCompact` | brief'i, dalı, manifest'i ve kabul kriterlerini sıkıştırma özetine sabitler |
| `PreToolUse` (yazmalar) | devralınmamış bir web/boş dizinde web kaynağına ilk yazma `ask` döner, framework'ü ve prosedürü adıyla söyler |

Koşum takımını ilgilendirmeyen bir projede Halka 0'ın bedeli tek bir kısa ömürlü süreçtir (~45 ms)
ve **sıfır token**.

### Halka 1 — `.claude/web-dev/` varsa devreye girer

| Hook | Ne yapar |
|---|---|
| `PreToolUse` | manifest dışı yazmaları, taint ile doğrulanmış açıkları, eklenen yorumları, bildirilmemiş bağımlılıkları, yıkıcı göçleri, varsayılan dala commit'i, stdin'den program yiyen yorumlayıcıları, yükü saklayan iç içe kabukları, başka yeri gösteren `git -C`/`worktree`'yi, PowerShell yazmalarını ve proje kökü dışına yazmayı engeller |
| `PostToolUse` | yazmayı, onayı ve soru defterini kaydeder; PR adresini yakalar |
| `PostToolBatch` | grup başına tek harita render'ı, hâlâ borçlu notlar, ve kurulum sonrası bağımlılık denetimi |
| `PostToolUseFailure` | sık görülen bir araç hatasını, onu çözen tek adıma çevirir |
| `FileChanged` | hiçbir aracın yapmadığı değişiklikler dahil her dosya değişikliğini görür; koşum takımı durumuna yazmayı kurcalama olarak işaretler |
| `PermissionRequest` | yalnızca koşum takımının kendi komutlarını sessizce onaylar |
| `SubagentStart` | her alt ajana harita okuma sırasını ve güncel sağlığı verir |
| `SubagentStop` | inceleyicinin kararını, incelediği diff'e bağlı kaydeder |
| `Stop` | kapanış denetimi |
| `ConfigChange` | neyin zorlandığına karar veren dosyaların görev ortasında değişmesini reddeder |
| `SessionEnd` | görev durumunu kaydeder |

Bozulan kapı, kapatan kapıdır: hook'un kendisi hata verirse çağrı kontrolsüz geçmez, reddedilir.

### Stop hook'u neyi kontrol eder

Sırayla, turu bitmekten alıkoyan ilk hatayı döndürerek:

1. `wd verify` **mevcut ağaç hash'i için** kayıtlı bir başarı taşıyor.
2. Kaynak davranışı değiştiyse bir test de değişti — brief onaylı `Tests: none` kaydetmediyse.
3. UI değiştiyse `wd responsive` **mevcut UI hash'i için** kayıtlı bir başarı taşıyor.
4. Bu turun dokunduğu dosyalar için `wd note missing` boş ve `wd check` yeni hata bildirmiyor.
5. İnceleyiciden **mevcut diff hash'i için** `VERDICT: PASS`.
6. `## Durable` altındaki her id `product.md`, `stack.md` veya `decisions.md`'de var.
7. Ağaç temiz, dal push edilmiş, bir PR açık.
8. Derin tarama koştu ve temiz — ve koşamayan bir derin tarama sessizlik değil, engeldir.

Altyapı hataları — ağ yok, `gh` yetkisiz, dev sunucu kapalı — size manuel adımla bildirilir ve
sessizce geçmez.

Aynı engelin üçüncü tekrarında hook kendini tekrar etmeyi bırakır: engellemeye devam eder ama
gerekçeyi bir yükseltmeye çevirir, sonraki her oturumun göstereceği kalıcı bir `STUCK` işareti
kaydeder ve modele nasıl ilerleyeceğinizi size sormasını söyler.

---

## Güvenlik

İki katman, ve ayrım bilinçli.

### Zorlanan — deterministik, taint tabanlı, yazma anında engellenir

Her sink kuralı **taint** ister: değerin bir istekten, parametreden, header'dan, çerezden veya
gövdeden geliyor olması. Gömülü ya da sunucu kaynaklı değerler tetiklemez; yani bir bulgu her zaman
kullanıcının kontrol ettiği veriyle ilgilidir.

| Grup | Kurallar |
|---|---|
| Enjeksiyon ve çalıştırma | `WD-SEC-EVAL`, `WD-SEC-SQL-INTERP`, `WD-SEC-CMD-INTERP`, `WD-SEC-XSS-HTML`, `WD-SEC-PROTO` |
| İstek kaynaklı noktalar | `WD-SEC-SSRF`, `WD-SEC-PATH`, `WD-SEC-REDIRECT` |
| Taşıma ve kimlik | `WD-SEC-TLS-OFF`, `WD-SEC-JWT`, `WD-SEC-CORS`, `WD-SEC-COOKIE`, `WD-SEC-POSTMESSAGE` |
| Sırlar ve kripto | `WD-SEC-SECRET`, `WD-SEC-PUBLIC-ENV`, `WD-SEC-RANDOM`, `WD-SEC-HASH` |
| Tedarik zinciri | `WD-SEC-SCRIPT-FETCH` (kod indirip çalıştıran script), `WD-SEC-LIFECYCLE` (yeni kurulum-zamanı hook'u), `WD-DEP`, `WD-DEP-VULN` |
| Değişim kontrolü | `WD-SEC-MIGRATION`, `WD-COMMENT` |

Haritalardan gelen, `wd check` ve kapanışta kontrol edilenler: `WD-API-UNAUTH` (`auth: NONE` olan
bir mutasyon rotası), `WD-API-UNVALIDATED`, `WD-API-UNMATCHED`, `WD-DATA-MULTIWRITER`.

`opengrep` veya `semgrep` kuruluysa, kapanışta görevin diff'i üzerinde dokuz ek taint kuralı
`WD-DEEP:*` olarak koşar.

### Muhakemeli — brief'te belirtilir, inceleyici kontrol eder

Hiçbir kalıbın karar veremeyeceği şeyler: **yetkilendirme** (en üst sıradaki sınıf ve statik
analizin en çok kaçırdığı), kimlik doğrulama ve oturum yönetimi, girdi doğrulama kapsamı, çıktı
kodlama ve CSP, CSRF, istisnai durum yönetimi (auth veya ödeme yolunda yutulan `catch` ya da
fail-open varsayılan yok), deserializasyon, ReDoS, yüklemeler, dış istek allowlist'i, sır hijyeni,
ödemeler ve webhook'lar, kişisel veri, güvenlik header'ları ve tedarik zinciri politikası.

Statik analiz gerçek açıkların kabaca yarısını kaçırır ve en çok da en üst sıradaki sınıflarda
kaçırır. Temiz bir tarama tavan değil tabandır; bu koşum takımı bunu aksini ima etmek yerine açıkça
söyler.

### Yorumlar

Kaynağa eklenen yorumlar engellenir; açıklamalar notlara aittir. İzin verilen pragmalar
`config.json` `comments.allowedPragmas` içindedir — tip ve lint kaçışları, bundler ipuçları, JSX
pragmaları, coverage ignore'ları, `#__PURE__` ve yapılandırılmış lisans başlığı.
`eslint-disable-next-line` asla bir güvenlik kuralını kapsamaz. `TODO` ve `FIXME` engel değil
uyarıdır: dürüst yerleri bir not ya da `wd defer`'dır.

---

## Haritalar

`.claude/web-dev/maps/` altına üretilir, gitignore'dadır, istendiğinde yeniden kurulur. Koddan
çıkarılan mekanik olguları, sizin ve modelin yazdığı ve **commit'lenen** notlarla birleştirir.

| Harita | Neyi cevaplar | Ne zaman var |
|---|---|---|
| `index.md` | özellik → shard'lar, giriş dosyaları, rotalar, sayfalar, tablolar, durum | her zaman |
| `codemap-<shard>.md` | her adlandırılmış sembol: imza, satır aralığı, import'lar, kim çağırıyor, db erişimi, çağrılar, not | her zaman |
| `apimap.md` | rota ↔ handler ↔ auth ↔ girdi şeması ↔ çıktı ↔ tablolar ↔ frontend çağıranlar | rota varsa |
| `uimap.md` | rota → layout → bileşen ağacı, istemci/sunucu sınırı, veri çekme, metadata | UI varsa |
| `datamap.md` | tablolar, sütunlar, ilişkiler, okuyanlar ve yazanlar, tek-yazan kontrolü, env yüzeyi | DB veya env varsa |

Bir codemap satırı:

```
## src/features/orders/note.ts | K2 | sys: orders | role: order note persistence
imports: src/lib/db.ts | used-by: src/app/api/orders/[id]/route.ts
- saveNote(orderId: string, text: string): Promise<Order> | L4-18 | trims and caps at 500 chars; throws on unknown order | db: w orders | calls: db.order.update
```

### Durum sözlüğü

Bilinçli olarak ayrı tutulan iki farklı şey:

- **Tanımsız** — `MISSING`. Sembolün henüz notu yok. Devralınan bir depoda normaldir. Asla
  engellemez ve haritayı asla `DEGRADED` yapmaz; yalnızca mevcut görevin yazdığı dosyalar için
  borçtur.
- **Yanlış** — `STALE`, `ORPHAN`, `UNRESOLVED`, `MOVED`. Harita, kodun artık desteklemediği bir şey
  iddia ediyor. Bunlar haritayı `DEGRADED` yapar ve görevin kendi yollarında durduklarında engeller.

`STALE`, sembolün normalize edilmiş gövdesinin not yazıldıktan sonra değiştiği anlamına gelir;
biçimlendirme ve yorumlar buna asla yol açmaz. `MOVED`, bir notun yeniden adlandırmayı takip
ettiğini gösterir — gövde hash'i **ve** eşleşen bir ad ya da yol ile doğrulanır; tek başına hash
eşleşmesi bir notu alakasız bir sembole taşımaya yetmez.

### Maliyet

Gerçek kodda haritalar anlattıkları kaynağın yaklaşık onda biri kadardır. Bir shard açmak yerine
`wd map <yol>` veya `wd find <sembol>` ile okuyun; bir shard tek dosyanın kaydının on–yirmi katına
mal olur. Shard'lar token bütçesi taşır ve aşınca deterministik olarak bölünür.

Haritalar yeniden keşfi pahalı olanı saklar — sözleşmeler, değişmezler, çağrı ilişkileri, aşikâr
olmayan bir seçimin gerekçesi. Modelin tek çağrıda listeleyebileceği bir dizin ağacını asla saklamaz.

---

## Notlar

Notlar her haritanın anlamsal yarısıdır ve kodun açıklamasının yaşamasına izin verilen tek yerdir.
`.claude/web-dev/notes/<shard>.md` altında commit'lenirler.

```bash
node .claude/web-dev/wd.mjs note set <<'EOF'
{"key":"src/features/orders/note.ts","role":"order note persistence","sys":"orders","crit":"K2"}
{"key":"src/features/orders/note.ts#saveNote","note":"trims and caps at 500 chars; throws on unknown order"}
EOF
```

- En fazla 20 kelime: ne yapar, hangi değişmezi korur, nasıl bozulur. İmzayı asla tekrar etmez.
- Dışa açık her sembol ve beş satırdan uzun her iç fonksiyon için zorunlu.
- `crit`: `K1` uygulama açılmaz ya da temel akış bozulur · `K2` bir özellik bozulur · `K3` yaprak.
- `wd note set` gövde hash'ini damgalar, böylece notlar dosyasını yazmadan önce okumak gerekmez.
- `wd note missing --turn` mevcut turun hâlâ borçlu olduklarını listeler.

---

## `wd` — koşum takımı CLI'ı

Proje kökünden `node .claude/web-dev/wd.mjs <komut>` ile çalıştırılır. Bu dosya, eklentinin asıl
CLI'ını çözen bir shim'dir ve eklenti güncellendiğinde otomatik tazelenir.

| Komut | Yapar |
|---|---|
| `map <yol>` | tek dosyanın harita kaydı — harita okumanın varsayılan yolu |
| `find <sembol>` | bir sembol adı için her harita satırı |
| `class` | locate sonucundan görev sınıfı (`touch` / `task` / `arch`) |
| `defer "<madde>"` | kapsam dışı bir işi kuyruğa alır; `/clear` sonrası önünüze gelir |
| `config` / `config set <anahtar> <değer>` | `config.json`'ı okur ya da tanımlı tek bir anahtarı değiştirir |
| `maps [--force]` | bütün haritaları yeniden üretir |
| `note set` | stdin'deki JSON satırlarından not yazar |
| `note missing [--shard s] [--turn]` | hâlâ borçlu notları listeler |
| `task hash` | onay sorusu için 8 karakterlik hash |
| `task status` | durum makinesinin nerede olduğu |
| `check [--draft-blueprint]` | blueprint ↔ disk ↔ haritalar, dokümanlar ↔ paket sürümleri; `--draft-blueprint` devralma için rota/tablo/klasör envanterlerini yazar |
| `verify` | typecheck, lint, test, build — Stop hook'u için kaydedilir |
| `responsive [--path /x] [--url base]` | her yapılandırılmış viewport, ekran görüntüleriyle |
| `scan <dosyalar…>` | HEAD'e karşı güvenlik, sır ve yorum taraması |
| `scan --all --report` | kural bazında gruplanmış proje geneli taban çizgisi |
| `review-prep` | inceleyicinin okuyacağı diff'i ve bağlamı yazar |
| `pr-body` | brief ve kayıtlı sonuçlardan kurulan PR açıklaması |
| `facts check` | sabitlenmiş sürümü lockfile ile uyuşmayan olgular |
| `id D` / `id R` | sıradaki boş karar veya gereksinim id'si |
| `setup` | bu makine için sabitlenmiş ayrıştırıcıyı kurar |

---

## Yapılandırma

`.claude/web-dev/config.json` kapının neyi zorladığına karar verir; bu yüzden yazma kapısı doğrudan
düzenlemeyi reddeder. `wd config set <noktalı.anahtar> <değer>` ile ya da kullanıcı olarak elle
değiştirin.

| Anahtar | Varsayılan | Anlamı |
|---|---|---|
| `userLanguage` | `"en"` | soruların ve özetlerin yazıldığı dil |
| `defaultBranch` | `"main"` | üzerine asla kaynak yazılmaz |
| `git.remote` | `"origin"` | `"none"` push ve PR zorunluluğunu kapatır |
| `git.pullRequest` | `true` | kapanışın açık bir PR isteyip istemediği |
| `packageManager` | `"npm"` | kapının tanıdığı kurulum komutunu belirler |
| `frameworks` | `[]` | tespit yanlış tahmin ettiğinde geçersiz kılar |
| `commands.typecheck/lint/test/build/dev` | tespit edilir | `wd verify`'ın çalıştırdıkları |
| `devUrl` | `http://localhost:3000` | `wd responsive`'in baktığı yer |
| `responsive.viewports` | `[[360,800],[768,1024],[1440,900]]` | telefon, tablet, masaüstü |
| `responsive.paths` | `["/"]` | brief hiçbirini adlandırmazsa kontrol edilen rotalar |
| `responsive.minTapTargetPx` | `44` | bunun altındaki kontrol raporlanır |
| `responsive.minFontPx` | `12` | bunun altındaki metin raporlanır |
| `generated` | dört glob | yorum ve kalıp kurallarından muaf yollar, yine de sır taranır |
| `authMarkers` | ~30 isim | apimap'in auth kontrolü saydığı şeyler |
| `validationMarkers` | ~15 isim | apimap'in girdi doğrulaması saydığı şeyler |
| `approval.labels` / `approval.tokens` | `Approve`/`Onayla`, `APPROVE`/`ONAY` | nasıl onayladığınız |
| `comments.licenseHeader` | `""` | yorum kuralından muaf bir başlık |
| `comments.allowedPragmas` | ~14 pragma | eklenmesine izin verilen tek yorumlar |
| `security.gitleaks` / `opengrep` / `osvScanner` | `"auto"` | `"auto"` araç kuruluysa kullanır; `"off"` kapatır |
| `baseline` | kurulumdaki HEAD | öncesindeki mevcut kodun yargılanmadığı commit |

`.claude/web-dev/shards.json` yol desenlerini codemap shard'larına eşler — ilk eşleşen kazanır, son
kayıt yakalayıcıdır — ve bir shard'ın token bütçesini sınırlar.

---

## Proje dosyaları

| Commit'lenen | Üretilen, gitignore'da |
|---|---|
| `CLAUDE.md` (`.claude/web-dev/CLAUDE.md`'yi import eder) | `.claude/web-dev/maps/` |
| `.claude/settings.json` (eklenti teklifi + deny'lar, hook yok) | `.claude/web-dev/state/` |
| `.claude/agents/{Explore,web-dev-reviewer,web-dev-annotator}.md` | `.claude/web-dev/work/` |
| `.claude/rules/web-dev-*.md` | `.claude/web-dev/shots/` |
| `.claude/web-dev/{product,stack,decisions,blueprint}.md` | `.claude/web-dev/wd.mjs` |
| `.claude/web-dev/notes/`, `facts/` | `.claude/web-dev/statusline.mjs` |
| `.claude/web-dev/{config,shards,enforce}.json` | |

`enforce.json` kapıyı deponun her klonunda kuran dosyadır. Onay kaydının kendisi projenin
**dışında**, eklentinin veri dizininde, brief hash'ine karşı HMAC imzalı olarak durur — böylece
depoya yazabilen bir süreç bile bir onayı taklit edemez.

---

## Alt ajanlar

Ayar ve eklenti hook'ları alt ajanların içinde de çalışır; bu yüzden bir alt ajan manifest dışına
yazamaz. Varsayılan tek ajandır; bir alt ajan ancak gerçekten paralelleşen ya da uygulama
oturumunun muhakemesi bağlamda olmadan koşması gereken iş için maliyetini hak eder.

| Ajan | Rolü |
|---|---|
| `Explore` (override) | harita-önce konumlandırıcı; aynı sırayı izler ve hangi adımda durduğunu bildirir |
| `web-dev-reviewer` | yalnızca hazırlanmış diff'i ve onaylı brief'i okur; `VERDICT: PASS` ya da `VERDICT: FAIL` döner |
| `web-dev-annotator` | devralma ya da toplu onarımda her seferinde tek shard için not yazar |

`AskUserQuestion` her alt ajandan çıkarılmıştır; yani size sorulan her soruyu ana ajan sorar.
İnceleyici yalnızca doğruluğu ya da belirtilmiş bir gereksinimi etkileyen boşlukları bildirir —
asla stil — çünkü boşuna kurt diyen bir inceleyici, o adımı atlatmanın en hızlı yoludur.

---

## Bağlam ve `/clear`

Koşum takımı bağlam başına tek görev üzerine kurulu. Bu bir üslup tercihi değil: uzun bağlamlar
talimat takibini ölçülebilir biçimde bozar ve çok turlu birikim bunu, herhangi bir token sınırından
bağımsız olarak, daha da bozar.

Bu yüzden her durum parçası diskte yaşar ve `/clear` hiçbir şeye mal olmaz:

- `SessionStart` sağlığı, görevi, haritaları ve git konumunu yeniden okur.
- `PreCompact` brief'i, dalı, manifest'i ve kabul kriterlerini sıkıştırma özetine sabitler ve
  modele yeniden planlamamasını, onayı yeniden istememesini açıkça söyler.
- Bir görev kapandığında `wd defer` ile kuyruğa alınan her şey `work/next.md`'ye yazılır; `/clear`
  sonrası oturum onunla açılır.
- Bir görevin kapandığı oturumda tekrar yazmaya başlarsanız ilk yazma bir kez sorar, görevi ve
  PR'ını adıyla söyleyerek.

**Hiçbir hook `/clear` çalıştıramaz.** Bu bir platform sınırıdır ve koşum takımı bunu numara
yapmak yerine söyler. Bunun yerine yaptığı şey: temizlemeyi bedelsiz kılmak, zamanı geldiğini
söylemek ve öbür tarafta işi kaldığı yerden almak.

---

## Token maliyeti

Bu depoda ölçüldü, tahmin edilmedi:

| | v1 | v2 |
|---|---|---|
| Her oturumda, her zaman | ~335 tok | ~456 tok |
| Skill gövdesi tetiklendiğinde | ~5.400 tok | ~2.900 tok |
| Harita/kaynak okumadan önceki metin, `touch` | ~12.200 tok | ~3.600 tok |
| Harita/kaynak okumadan önceki metin, `task` | ~12.200 tok | ~7.700 tok |
| Harita/kaynak okumadan önceki metin, `arch` | ~12.200 tok | ~10.400 tok |
| Haritalar / anlattıkları kaynak | — | 0,11 |
| İlgisiz bir projede hook maliyeti | — | 45 ms, 0 token |

Bir test her talimat dosyası için bayt bütçesini ve görev sınıfı başına toplam tavanı zorunlu
kılar; böylece yönlendirme metni sessizce büyüyemez.

---

## Sorun giderme

**`[web-dev]` satırı hiç görünmüyor.**
Eklenti kapalı ya da hook'lar kapalı. `claude plugin list`, sonra `/hooks`. Kullanıcı, proje veya
yerel ayarlardaki bir `disableAllHooks: true` her şeyi kapatır.

**`NOT ARMED` diyor.**
`.claude/web-dev/enforce.json` eksik; yani yazma kapısı, güvenlik taraması ve kapanış denetimi
kapalı ama gerisi kurulu görünüyor. Dosyayı git'ten geri alın ya da `/web-dev:init`'i yeniden
çalıştırın.

**`TAMPER` diyor.**
`.claude/web-dev/state/` içine hook'lardan başka bir şey yazmış. Onay ve tur kayıtları, bir sonraki
tur denetimi onları yeniden türetene kadar güvenilmez sayılır. Genellikle başıboş bir script ya da
bir merge'dür; brief'i yeniden onaylayın.

**`STUCK` diyor.**
Aynı kapanış kontrolü üç ya da daha fazla turdur engelliyor. Gerekçe satırda. Modelle birlikte
karar verin: farklı şekilde düzeltin, brief'e kabul edilmiş bir istisna olarak kaydedin, ya da ayrı
bir göreve bölün.

**Bir yazma reddedildi ve katılmıyorsunuz.**
Reddetme mesajı kuralı ve düzeltmeyi adıyla söyler. Gerçekten yanlış pozitifse yalnızca brief'teki
`Security exceptions:` ile kabul edilir — bu hash'i değiştirir, yani yeniden onaylarsınız ve tam
olarak neyi kabul ettiğinizi görürsünüz.

**`wd responsive` Playwright yok diyor.**
`npm i -D @playwright/test @axe-core/playwright && npx playwright install chromium`. Bağımlılık
eklemek de her şey gibi brief'ten geçer.

**Derin tarama koşamadığını söylüyor.**
Bu bilinçli — koşmamış bir tarama kanıt değildir. `opengrep`/`semgrep`'i düzeltin ya da
`wd config set security.opengrep off` ile kapatın.

**Dal değiştirdikten sonra haritalar yanlış görünüyor.**
`wd maps --force`.

**Görev onay bekliyor gibi takıldı.**
`wd task status` durum makinesinin nerede olduğunu, `wd task hash` onaylanacak hash'i yazar.

---

## Kaldırma

```bash
claude plugin uninstall web-dev@web-dev
claude plugin marketplace remove web-dev
```

Proje durumunu da silmek için: `.claude/web-dev/`, üç `.claude/agents/web-dev-*` dosyası,
`.claude/rules/web-dev-*.md`, `CLAUDE.md`'deki `@.claude/web-dev/CLAUDE.md` import satırı ve
`.claude/settings.json`'daki `web-dev` bloğu. Kodunuza dokunulmaz — koşum takımı uygulama kaynağını
asla yazmaz.

---

## Eklentiyi geliştirme

```bash
npm run setup                     # sabitlenmiş ayrıştırıcıyı kullanıcı önbelleğine kurar
npm test                          # node:test — 237 test
npx playwright install chromium   # yalnızca responsive testleri için gerekli
claude plugin validate . --strict
```

Paket şunları içerir:

- **`wiring`** — her hook yolu, `${…}` yer tutucusu ve yönlendirilen dosya diskte çözülüyor;
  `PreToolUse` matcher'ı gerçekten MCP araçlarına ulaşıyor; her talimat dosyası bayt bütçesinde.
- **`gate`** — düşmanca: heredoc'la beslenen yorumlayıcılar, iç içe kabuklar, `git -C`,
  `git worktree add`, PowerShell yazmaları, kökten kaçan yollar ve zorlama dosyaları.
- **`trigger`** — boş, web, aday ve web-olmayan dizinlerde Halka 0; izleme listesi; `/clear` döngüsü.
- **`state`** — gerçek eşzamanlılık altında kilitleme, HMAC onay bütünlüğü, soru defteri, görev
  sınıflandırıcı.
- **`security`** — 55 vaka, her hata düzeltilmeden önce yeniden üretildi.
- **`maps`** — dört framework fixture'ı artı gerçekçi bir derlem üzerinde ölçülen harita/kaynak oranı.
- **`tools`** — paketlenmiş opengrep kural setinin yüklendiğini ve her kuralın ateşlediğini kanıtlar;
  ikili yoksa temiz atlar.
- **`responsive`** — gerçek sunucu, gerçek tarayıcı, gerçek ekran görüntüsü.

Sürüm çıkarma: `.claude-plugin/plugin.json` içindeki `version`'ı yükseltin, commit'leyin, push edin,
sonra `claude plugin tag . --push`.

---

## Tasarım notları

Keyfî görünebilecek birkaç karar:

**Neden kodda yorum yok.** Bir yorumun bayatlamama garantisi yoktur — hâlâ doğru olup olmadığını
hiçbir şey kontrol etmez. Bir not ise sembolün gövde hash'ine bağlıdır; gövde değiştiğinde not
`STALE` işaretlenir ve onu değiştiren görev onu onarmak zorundadır. Açıklamaları notlara taşımak,
"dokümantasyon asla yanlış değildir"i temenni olmaktan çıkarıp zorlanabilir kılan şeydir.

**Neden onay hash'e bağlı.** Aksi hâlde "kullanıcı bunu onayladı" kayar: brief düzenlenir, kapsam
büyür ve onay hiç görmediğiniz işi sessizce kapsar.

**Neden kapı `PreToolUse`'ta.** İzin sisteminden önce, `bypassPermissions` dahil her modda çalışan
tek hook bu. Başka bir yerdeki kural, kapatılabilen bir kuraldır.

**Neden dosya sistemi izleniyor.** Araçları kapılamak, bir dosyayı yazmanın her yolunu saymayı
gerektirir ve o liste asla tamamlanmaz. Ağacı izlemek, izinsiz bir yazmanın engellenmemiş olsa bile
*görülmesi* demektir — ve tur denetimi o zaman onun üzerine kapanmayı reddedebilir.

**Neden üç görev sınıfı.** Tek satırlık bir CSS düzeltmesini faz kapılarından geçirmek, bu araç
kategorisine yapılan en sık eleştiridir; ve etrafından dolaşılan bir kapı hiçbir şeyi korumaz.

---

## Bilinen sınırlar

- **`/clear` zorlanamaz.** Hiçbir hook bir konuşmayı temizleyemez ya da sıkıştıramaz. Koşum takımı
  temizlemeyi bedelsiz kılar ve zamanı geldiğini söyler.
- **Statik analiz yetkilendirme ya da iş mantığı hatalarını göremez.** Muhakeme listesi ve inceleyici
  bunun içindir; ve temiz bir taramanın asla "güvenli" diye raporlanmamasının sebebi budur.
- **PowerShell yazmaları ayrıştırılmaz, reddedilir.** Komut kapısı POSIX kabuğu konuşur;
  okuyamadığı bir cmdlet'i tahmin etmektense reddeder ve Edit/Write'ı gösterir.
- **`wd responsive` projede Playwright** ve erişebileceği bir dev sunucu ister.
- **Derin tarama `opengrep` veya `semgrep` kurulu değilse sessizdir** — ve bunu söyler.
- **Çıkarıcı `typescript@6.0.3`'e sabitlenmiştir**, çünkü TypeScript 7 kullandığı JavaScript
  derleyici API'sini kaldırdı.

---

## Lisans

MIT
