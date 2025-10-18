# Hello World


## Paragraph sample

Kului aikoa vähäisen, pirahteli pikkaraisen.
Tuli sotka, suora lintu; lenteä lekuttelevi
etsien pesän sijoa, asuinmaata arvaellen.

Liitelevi, laatelevi; arvelee, ajattelevi:
"Teenkö tuulehen tupani, aalloillen asuinsijani?
Tuuli kaatavi tupasen, aalto vie asuinsijani."

Niin silloin ve'en emonen, veen emonen, ilman impi,
nosti polvea merestä, lapaluuta lainehesta
sotkalle pesän sijaksi, asuinmaaksi armahaksi.

Tuo sotka, sorea lintu, liiteleikse, laateleikse.
Keksi polven veen emosen sinerväisellä selällä;
luuli heinämättähäksi, tuoreheksi turpeheksi.

Lentelevi, liitelevi, päähän polven laskeuvi.
Siihen laativi pesänsä, muni kultaiset munansa:
kuusi kultaista munoa, rautamunan seitsemännen.

Alkoi hautoa munia, päätä polven lämmitellä.
Hautoi päivän, hautoi toisen, hautoi kohta kolmannenki.

Jopa tuosta veen emonen, veen emonen, ilman impi,
tuntevi tulistuvaksi, hipiänsä hiiltyväksi;
luuli polvensa palavan, kaikki suonensa sulavan.

Vavahutti polveansa, järkytti jäseniänsä:
munat vierähti vetehen, meren aaltohon ajaikse;
karskahti munat muruiksi, katkieli kappaleiksi.

Ei munat mutahan joua, siepalehet veen sekahan.
Muuttuivat murut hyviksi, kappalehet kaunoisiksi:
munasen alainen puoli alaiseksi maaemäksi,
munasen yläinen puoli yläiseksi taivahaksi;
yläpuoli ruskeaista päivöseksi paistamahan,
yläpuoli valkeaista, se kuuksi kumottamahan;
mi munassa kirjavaista, ne tähiksi taivahalle,
mi munassa mustukaista, nepä ilman pilvilöiksi.



This is **bold** text and this is *italic* text.

## Features

Some text content for an example paragraph.

Some text content for an example paragraph.

Some text content for an example paragraph.

Some text content for an example paragraph.

Some text content for an example paragraph.

- Item 1
- Item 2
- Item 3

### Ordered List

1. Item 1
2. Item 2
3. Item 3

### Code Example

``` javascript
const hello = "world";
console.log(hello);

function someFn({param, param2}){

  const data = {
    count: 0,
    value: param + param2
  }

  return (addedValue) => {
    data.count++
    data.value += addedValue

    return data
  }
}

const fn = someFn(1,2)

console.log(fn(3))
```

> This is a blockquote
> with multiple lines

Visit [example.com](https://example.com) or www.github.com

### Images

![Example Image 1](https://picsum.photos/600/400)

![Example Image 2](https://picsum.photos/500/350)

### Tables

| Feature | Description | Status |
|---------|:-----------:|-------:|
| Tables  | Markdown tables with alignment | ✅ |
| Info Blocks | Colored notification blocks | ✅ |
| Virtual Scroll | Canvas performance optimization | ✅ |

### Info Blocks

::: info
This is an informational message. It can contain **bold text**, *italic text*, and `inline code`.
:::

::: warning
This is a warning message. Pay attention to this important notice!
:::

::: error
This is an error message. Something went wrong and needs your attention.
:::

::: success
This is a success message. Everything completed successfully!
:::

---

**Strong text** and `inline code`.


---



### Unicode support with Canvas renderer partially complete

inline emojis:

- hearts `❤️❤️❤️`

### 🌀 **Combining Marks & Normalization**

| Sample | Name                                   | Code Points          | Notes                    |
| ------ | -------------------------------------- | -------------------- | ------------------------ |
| é     | e + COMBINING ACUTE ACCENT             | U+0065 U+0301        | NFD form of “é”          |
| é      | LATIN SMALL LETTER E WITH ACUTE        | U+00E9               | NFC form                 |
| Ã̄    | A + COMBINING TILDE + COMBINING MACRON | U+0041 U+0303 U+0304 | Multiple combining marks |
| 가      | HANGUL SYLLABLE GA                     | U+AC00               | Precomposed Hangul       |
| 가     | HANGUL CHOSEONG KIYEOK + JUNGSEONG A   | U+1100 U+1161        | Decomposed Hangul        |

---

### ⚪ **Whitespace & Invisibles**

| Sample | Name                  | Code Points | Notes                      |
| ------ | --------------------- | ----------- | -------------------------- |
| ␣      | SPACE                 | U+0020      | Standard space             |
|        | NO-BREAK SPACE        | U+00A0      | Non-breaking               |
|        | EM SPACE              | U+2003      | Wide space                 |
|        | THIN SPACE            | U+2009      | Narrow space               |
|        | ZERO WIDTH SPACE      | U+200B      | Invisible joiner           |
| ‌      | ZERO WIDTH NON-JOINER | U+200C      | Affects ligatures          |
| ‍      | ZERO WIDTH JOINER     | U+200D      | ZWJ sequence joiner        |
|       | LINE SEPARATOR        | U+2028      | Line-breaking              |
|       | PARAGRAPH SEPARATOR   | U+2029      | Line-breaking              |
|        | NARROW NO-BREAK SPACE | U+202F      | Used in French punctuation |
| 　      | IDEOGRAPHIC SPACE     | U+3000      | Full-width space (CJK)     |

---

### 🧭 **Bidirectional Text**

| Sample         | Description             | Code Points                         | Notes                        |
| -------------- | ----------------------- | ----------------------------------- | ---------------------------- |
| Hello سلام 123 | Mixed English/Arabic    | U+0048…U+0633 U+0644 U+0627 U+0645… | Direction changes mid-string |
| שלום!          | Hebrew with punctuation | U+05E9 U+05DC U+05D5 U+05DD U+0021  | RTL with LTR punctuation     |

---

### 😃 **Emoji Edge Cases**

| Sample      | Description                  | Code Points                                  | Notes                |
| ----------- | ---------------------------- | -------------------------------------------- | -------------------- |
| ❤︎          | Heart (text)                 | U+2764 U+FE0E                                | Text presentation    |
| ❤️          | Heart (emoji)                | U+2764 U+FE0F                                | Emoji presentation   |
| 👍🏽        | Thumbs Up + Medium Skin Tone | U+1F44D U+1F3FD                              | Skin tone modifier   |
| 👨‍👩‍👧‍👦 | Family (ZWJ sequence)        | U+1F468 200D 1F469 200D 1F467 200D 1F466     | ZWJ sequence         |
| 🇫🇮        | Flag: Finland                | U+1F1EB U+1F1EE                              | Regional indicators  |
| 5️⃣         | Keycap 5                     | U+0035 U+FE0F U+20E3                         | Keycap sequence      |
| 👩‍💻       | Woman Technologist           | U+1F469 200D 1F4BB                           | ZWJ profession       |
| 👩‍❤️‍💋‍👨 | Kiss: woman, man             | U+1F469 200D 2764 FE0F 200D 1F48B 200D 1F468 | Complex ZWJ sequence |

---

### 🔣 **Symbols & Math**

| Sample | Name                    | Code Points          | Notes          |
| ------ | ----------------------- | -------------------- | -------------- |
| →      | RIGHTWARDS ARROW        | U+2192               | Basic arrow    |
| ⇔      | LEFT RIGHT DOUBLE ARROW | U+21D4               | Bidirectional  |
| ∫      | INTEGRAL                | U+222B               | Math symbol    |
| ∑      | N-ARY SUMMATION         | U+2211               | Math operator  |
| ─│┌┐└┘ | Box Drawing             | U+2500…U+2518        | Terminal boxes |
| ▁▄█    | Block Elements          | U+2581 U+2584 U+2588 | Density levels |

---

### 🀄 **CJK and Others**

| Sample | Name                | Code Points           | Notes                 |
| ------ | ------------------- | --------------------- | --------------------- |
| 汉字     | Chinese             | U+6C49 U+5B57         | Common CJK ideographs |
| かなカナ   | Japanese Kana       | U+304B 306A 30AB 30CA | Hiragana + Katakana   |
| 日本語    | Japanese Kanji word | U+65E5 672C 8A9E      | Mixed script          |
| 한글     | Korean Hangul       | U+D55C U+AE00         | Precomposed syllables |

---

### 🎵 **Supplementary Plane Characters**

| Sample | Name                          | Code Points | Notes                              |
| ------ | ----------------------------- | ----------- | ---------------------------------- |
| 𐍆     | Gothic Letter Faihu           | U+10346     | Plane 1 character                  |
| 𐍐     | Old Permic Letter An          | U+10350     | Plane 1                            |
| 𐐀     | Deseret Capital Letter Long I | U+10400     | Plane 1                            |
| 𝄞     | Musical Symbol G Clef         | U+1D11E     | Plane 1 (surrogate pair in UTF-16) |

---

### 🔡 **Ligatures & Typography**

| Sample | Name                 | Code Points | Notes                 |
| ------ | -------------------- | ----------- | --------------------- |
| ﬁ      | Latin ligature fi    | U+FB01      | May normalize to “fi” |
| Ⅻ      | Roman numeral twelve | U+216B      | Special number form   |

---

### 🧩 **Private Use Area**

| Sample | Name          | Code Points | Notes                            |
| ------ | ------------- | ----------- | -------------------------------- |
|       | PUA character | U+E000      | Undefined glyph (font-dependent) |

---

