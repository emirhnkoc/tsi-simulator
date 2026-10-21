# ✈️ Turn Coordinator & Turn-and-Slip Simülatörü

[![GitHub Pages Deployment](https://img.shields.io/badge/GitHub%20Pages-Canl%C4%B1%20Demo-brightgreen?logo=github)](https://emirhnkoc.github.io/tsi-simulator/)
[![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?logo=vite)](https://vitejs.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-r186-black?logo=three.js)](https://threejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)

**EASA Modül 11A (Uçak Aerodinamiği, Yapıları ve Sistemleri - Göstergeler s. 5.56-5.58)** müfredatına uygun, havacılık öğrencileri ve meraklıları için geliştirilmiş **yüksek etkileşimli 3B web simülasyonu**.

Simülatör; **Turn-and-Slip Indicator (Dönüş ve Kayış Göstergesi)** ile **Turn Coordinator (Dönüş Koordinatörü)** arasındaki mekanik, fiziksel ve operasyonel farkları canlı 3B uçak uçuş dinamiği ve şeffaf iç mekanizma modeliyle görselleştirir.

🌐 **Canlı Demo:** [https://emirhnkoc.github.io/tsi-simulator/](https://emirhnkoc.github.io/tsi-simulator/)

---

## 🎯 Temel Özellikler

### 1. Canlı Gösterge Paneli
- **Turn Coordinator**: 30° eğik gimbal ekseni sayesinde hem **Roll (Yatış)** hızını hem de **Yaw (Dönüş)** hızını birleşik olarak algılar. Minyatür uçak sembolü ve 2 dakikalık standart dönüş (Standard Rate Turn, 3°/s) indeksleri.
- **Turn-and-Slip Indicator**: Yatay gimbal ekseni ile yalnızca **Yaw (Dönüş)** hızını algılar; yatış hareketine anlık tepki vermez. Klasik iğne göstergesi ve 2/4 dakikalık dönüş çizgileri.
- **İnklinometre (Kayış / Savrulma Topu)**: Uçak gövdesine etki eden gerçek yanal G kuvvetlerini (merkezkaç vs. yerçekimi) sönümlü fizik formülüyle simüle eden cam tüp ve bilye.
- **Güç Kesintisi & Red Flag Mekanizması**: DC elektrik kesildiğinde gyronun devirden düşüşünü (spin-down) ve yaylı mekanizmayla açılan kırmızı ikaz bayrağını (*Power Off Flag*) tam simüle eder.

### 2. Şeffaf 3B İç Mekanizma Görünümü (`Mekanizma`)
- **Turn & Slip Mekanizması**: Boyuna yatay gimbal halkası, yüksek devirli rotor, iğneye bağlı dişli çark treni, merkezleme yayları ve hava sönümleme silindiri (*dashpot / damper piston*).
- **Turn Coordinator Mekanizması**: Gövde eksenine göre **30° yukarı eğik** yerleştirilmiş gimbal yatağı, doğrudan mekanik bağlantı, amortisör silindiri ve elektrik motoru kablolaması.
- **Canlı Presezyon**: Uçak yatış veya dönüşe geçtiğinde gyronun presesyon tepkisi, yayların gerilmesi ve mekanik kolların hareketi birebir incelenebilir.

### 3. 3B Canlı Kırsal Dünya
- **Güneşli ve Huzurlu Kırsal Atmosfer**: Rayleigh/Mie saçılımlı dinamik gökyüzü, rüzgârla sürüklenen hacimli kümülüs bulutları ve ferah ışıklandırma.
- **Organik FBM 3B Arazi**: Zümrüt çayırlar, güneşli tepeler, kır çiçekleri tarlaları ve sıcak kumlu nehir kıyıları.
- **Dalgalı 3B Su Yüzeyi**: Domain-warped FBM dalgacıkları, su altı güneş kostikleri (*caustics*) ve doğal kıyı köpükleriyle akan kıvrımlı nehir ve göl havzası.
- **360° Alp Dağ Sıraları**: 520×16 çözünürlüklü Ridged-Multifractal dağ geometrisi ve piksel bazlı granit kayalık & kar oluğu shader'ı.
- **Yolla Hizalı 3B Taş Kemer Köprü**: Nehir boyunca uzanan kıvrımlı asfalt yolu bağlayan, 4 dalgakıran ayağı ve 8 feneri bulunan 3 kemerli taş köprü.
- **Detaylı 3B Tekneler ve İskeleler**: Göl ve nehirde dalgalarla salınan 12 adet yelkenli yat (ana yelken & flok), ahşap kürekli sandal ve gezi motoru; karaya sıfır ahşap marina ve iskeleler.
- **Bölgesel Havaalanı & Yel Değirmeni**: Pist işaretlemeleri, PAPI ışıkları, taksi yolları, hangarlar, terminal, dönen fenerli kontrol kulesi ve yamaçta dönen kırsal yel değirmeni.
- **Zengin Bitki Örtüsü**: ~1.700 adet ladin/çam ve meşe/sakura ağacı, ~2.700 çalı, ~6.800 ot/çiçek demeti ve verandali köy evleri.

### 4. Detaylı 3B Uçak & Canlı Uçuş Kontrolleri
- NACA profilli yüksek kanatlı genel havacılık uçağı (Cessna tarzı).
- **Canlı Kontrol Yüzeyleri**: Diferansiyel aileronlar, dönüşte back-pressure oluşturan elevatör, hız 85 kt altına düştükçe kademesiz açılan Fowler flaplar ve canlı rudder / burun kayması (*sideslip*).
- Dönen pervane diski, kanat ucu seyrüsefer lambaları ve kuyruk ikaz flaşörü.
- Uçuş yolu yönünü gösteren vektör oku (*Track Arrow*).

---

## 🎮 Klavye Kısayolları

| Tuş | İşlev |
|:---:|:---|
| `1` - `7` | **Senaryolar**: (1) Düz uçuş, (2) Standart sağ dönüş, (3) Standart sol dönüş, (4) Slip (kayma), (5) Skid (savrulma), (6) Roll girişi, (7) Sadece rudder |
| `Boşluk` | Simülasyonu Duraklat / Devam ettir |
| `S` | Yavaş çekim modu (×0.25) |
| `H` | Alt kontrol panelini gizle / göster |
| `M` | Görünüm geçişi: **3D Uçak** ↔ **Mekanizma** |
| `C` | Kamera açısı: **Arkadan** → **Üstten** → **Yörünge (Serbest Mouse Orbit)** |
| `T` | Mekanizma modunda: **Turn & Slip** ↔ **Turn Coordinator** |
| `L` | Mekanizma etiketlerini göster / gizle |
| `F` | DC elektriğini aç / kapat (OFF / Red Flag) |
| `P` | Etkileşimli Ders / Sunum Modu: Aç / Kapat |
| `→` / `←` | Sunum modunda sonraki / önceki slayta geç |
| `Q` / `E` | Canlı Rudder Trim düzeltmesi (sol / sağ) |
| `X` | Rudder'ı anında sıfırla |

---

## 🎤 Etkileşimli Sunum Modu (Ders Turu)

`P` tuşu veya arayüzdeki **🎤 Sunum** düğmesi tıklandığında 14 adımlık kapsamlı bir ders turu başlatılır:
1. **İki Gösterge, İki Ayrı Cihaz**: Turn Coordinator ve Turn & Slip'in ortak kasada bağımsız cayro + inklinometre barındırması.
2. **Standart Dönüş (2 MIN = 3°/s)**: 3°/s dönüş hızı, 2 dakikalık tam tur ve standart işaret.
3. **Kritik Yanılgı: Yatış Açısı ≠ Dönüş Hızı**: Aynı 3°/s için 75 kt'ta ~12°, 165 kt'ta ~24° yatış; hız geçişinde TC'nin roll nedeniyle kısa süre sapması.
4. **Koordineli Dönüş ve Kuvvet Dengesi**: Yerçekimi bileşeni ile merkezkaç kuvvetinin dengesi; top merkezde, uçak izi çember.
5. **Slip (İçe Kayma) ve 'Step on the Ball'**: Ters rudder ile yaw'un azalması, topun içe kayması ve rudder düzeltmesiyle merkezlenmesi.
6. **Skid (Dışa Savrulma)**: Yatışa göre fazla rudder, topun dışa savrulması ve stall riski.
7. **Roll Girişinde İki Göstergenin Farkı**: TC'nin roll'u hemen algılaması, T&S'in yaw oluşunca yetişmesi.
8. **İnklinometre: Sıvı Dolu Cam Tüp ve Bilye**: Cayrodan bağımsız, sönümleme sıvılı tüp ve bilye.
9. **Turn & Slip: Yatay Elektrikli Cayro ve Presesyon**: DC motorlu yatay rotor ve 90° faz farkıyla presesyon.
10. **Turn & Slip: Dairesel Plaka ve Tersleyici Çatal-Pim**: Gimbal hareketinin çatal-pim ile iğneye aktarımı.
11. **Turn & Slip: Kalibrasyon Yayı ve Pnömatik Dashpot**: Yay ile dönüş hızı oranı, dashpot ile sarsıntı sönümü.
12. **Turn Coordinator: 30° Yukarı Eğik Gimbal Ekseni**: Eğik eksenin hem yaw hem roll algılaması.
13. **Turn Coordinator: Sektör-Pinyon Dişlisi ve Cam Damper**: Sektör-pinyon aktarımı, cam piston damper ve PCB motoru.
14. **Elektrik Kesintisi ve 'OFF' Uyarı Bayrağı (Red Flag)**: DC kesintisinde bayrağın inmesi, ibrenin merkeze düşmesi; topun elektrikten bağımsız çalışmaya devam etmesi.

> İpucu: Sunum dışında sol dönüş için `3`, kanatlar düzken sadece rudder etkisi için `7` tuşunu kullanabilirsiniz.

---

## 📐 Fizik ve Matematik Modeli

1. **Koordineli Dönüş Hızı ($\omega$)**:
   $$\omega = \frac{g \cdot \tan\phi}{V}$$
   Burada $g$ yerçekimi ivmesi, $\phi$ yatış açısı (*bank angle*), $V$ hava süratidir (*true airspeed*). Rudder girdisi bu değere $\pm 4^\circ/\text{s}$ ekler.

2. **İnklinometre Top Açısı ($\theta_{\text{ball}}$)**:
   Uçak koordinat ekseninde bilyeye etki eden bileşke kuvvet:
   $$\theta_{\text{ball}} = \operatorname{atan2}(g \sin\phi - V\omega\cos\phi,\; g\cos\phi + V\omega\sin\phi)$$
   Bilye hareketi ikinci dereceden sönümlü yay-kütle diferansiyel denklemi ile simüle edilir.

3. **Gösterge Karşılaştırması**:
   - **Turn-and-Slip İğnesi**:
     $$I_{\text{TS}} \propto \omega_{\text{yaw}}$$
   - **Turn Coordinator Minyatür Uçağı**:
     $$I_{\text{TC}} \propto \omega_{\text{yaw}} + p \cdot \tan(30^\circ)$$
     ($p = \text{roll rate}$, yani yatış hızı).

---

## 🔗 URL Parametreleri

Sunumda doğrudan istenen konfigürasyonla başlatmak için URL parametreleri kullanılabilir:

```text
https://emirhnkoc.github.io/tsi-simulator/?s=roll&view=mechanism&mech=tc&panel=0
```

| Parametre | Değerler | Açıklama |
|---|---|---|
| `s` | `level`, `stdR`, `stdL`, `slip`, `skid`, `roll`, `rudder` | Başlangıç uçuş senaryosu |
| `view` | `aircraft`, `mechanism` | 3D Uçak veya Mekanizma ekranı |
| `mech` | `tns`, `tc` | Turn & Slip veya Turn Coordinator mekanizması |
| `cam` | `chase`, `top`, `orbit` | Kamera açısı (arkadan, üstten, serbest yörünge) |
| `panel` | `0`, `1` | Alt kontrol panelinin gizli/açık olması |
| `present` | `1` | Doğrudan Sunum Modunda başlatır |
| `step` | `1` - `14` | Sunum modundaki belirli adıma atlar |
| `pause` | `1` | Simülasyonu duraklatılmış başlatır |
| `power` | `0`, `1` | DC elektriğini kapatır / açar (varsayılan `1`) |
| `t` | `0` - `600` (saniye) | Simülasyonu belirtilen süre kadar ilerletip açar; sunum adımlarında yok sayılır |

---

## 🛠️ Kurulum ve Geliştirme

Projeyi çalıştırmak için:

```bash
# Bağımlılıkları yükleyin
npm install

# Geliştirme sunucusunu başlatın (http://localhost:5173)
npm run dev

# Standart dağıtım derlemesi (dist/)
npm run build

# İnternetsiz açılabilen tek dosya HTML derlemesi (dist-single/index.html)
npm run build:single
```
