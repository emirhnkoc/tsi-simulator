# Turn Coordinator & Turn-and-Slip Simülatörü

EASA Modül 11A (s. 5.56–5.58) konusunun sınıf sunumu için web tabanlı simülasyon.

🌐 **Canlı Demo (GitHub Pages):** [https://emirhnkoc.github.io/tsi-simulator/](https://emirhnkoc.github.io/tsi-simulator/)

## Çalıştırma

```bash
npm install
npm run dev            # geliştirme sunucusu (http://localhost:5173)
npm run build          # dist/        -> GitHub / kendi domain'ine yükle
npm run build:single   # dist-single/index.html -> internetsiz, çift tıklayıp aç
```

## Kısayollar

| Tuş | İşlev |
|---|---|
| `1`–`7` | Senaryolar: Düz, Std sağ, Std sol, Slip, Skid, Roll girişi, Sadece rudder |
| `Boşluk` | Duraklat / devam |
| `S` | Yavaş çekim (×0.25) |
| `H` | Alt paneli gizle / göster |
| `M` | 3D Uçak ↔ Mekanizma |
| `C` | Kamera: Arkadan ↔ Üstten |
| `T` | Mekanizma: Turn & Slip ↔ Turn Coordinator |

## URL parametreleri

Sunumda doğrudan istenen sahneyle açmak için kullanılır, örneğin:

```
index.html?s=roll&view=mechanism&mech=tc&panel=0
```

- `s`: `level` | `stdR` | `stdL` | `slip` | `skid` | `roll` | `rudder`
- `view=mechanism`, `mech=tc`, `cam=top`, `panel=0`
- `t`: simülasyonu bu kadar saniye ileri sararak başlatır

## Fizik modeli

- Koordineli dönüş hızı: ω = g·tanφ / V. Rudder, bu değere en fazla ±4°/s ekler.
- Top: uçak eksenindeki görünür yerçekiminin açısı, `atan2(g·sinφ − V·ω·cosφ, g·cosφ + V·ω·sinφ)`. Hareketi sönümlü yay gibi.
- Turn & Slip iğnesi yaw hızını gösterir. Turn Coordinator ise yaw hızı + roll hızı·tan30° gösterir.
- Standart dönüş (3°/s) iki göstergede de 20°'lik işarete karşılık gelir.
