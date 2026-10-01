// Turns Hindi (Devanagari) and Punjabi (Gurmukhi) lyrics into casual Hinglish, the way people type them:
// "मुझे इश्क़ हुआ है" -> "mujhe ishq hua hai". Latin text passes through unchanged.

interface Script {
  consonants: Record<string, string>;
  matras: Record<string, string>;
  vowels: Record<string, string>;
  nukta: string; nuktaForms: Record<string, string>;
  virama: string; nasals: string; visarga?: string; addak?: string;
}

const devanagari: Script = {
  consonants: {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "w",
    "श": "sh", "ष": "sh", "स": "s", "ह": "h",
    "क़": "q", "ख़": "kh", "ग़": "gh", "ज़": "z", "ड़": "d", "ढ़": "dh", "फ़": "f", "य़": "y",
  },
  matras: { "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॅ": "e", "ॉ": "o" },
  vowels: { "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o" },
  nukta: "़", nuktaForms: { "k": "q", "kh": "kh", "g": "gh", "j": "z", "d": "d", "dh": "dh", "ph": "f", "y": "y" },
  virama: "्", nasals: "ंँ", visarga: "ः",
};

const gurmukhi: Script = {
  consonants: {
    "ਕ": "k", "ਖ": "kh", "ਗ": "g", "ਘ": "gh", "ਙ": "n", "ਚ": "ch", "ਛ": "chh", "ਜ": "j", "ਝ": "jh", "ਞ": "n",
    "ਟ": "t", "ਠ": "th", "ਡ": "d", "ਢ": "dh", "ਣ": "n", "ਤ": "t", "ਥ": "th", "ਦ": "d", "ਧ": "dh", "ਨ": "n",
    "ਪ": "p", "ਫ": "ph", "ਬ": "b", "ਭ": "bh", "ਮ": "m", "ਯ": "y", "ਰ": "r", "ਲ": "l", "ਵ": "v", "ੜ": "d",
    "ਸ": "s", "ਹ": "h", "ਸ਼": "sh", "ਖ਼": "kh", "ਗ਼": "gh", "ਜ਼": "z", "ਫ਼": "f", "ਲ਼": "l",
  },
  matras: { "ਾ": "aa", "ਿ": "i", "ੀ": "ee", "ੁ": "u", "ੂ": "oo", "ੇ": "e", "ੈ": "ai", "ੋ": "o", "ੌ": "au" },
  vowels: { "ਅ": "a", "ਆ": "aa", "ਇ": "i", "ਈ": "ee", "ਉ": "u", "ਊ": "oo", "ਏ": "e", "ਐ": "ai", "ਓ": "o", "ਔ": "au", "ੲ": "", "ੳ": "" },
  nukta: "਼", nuktaForms: { "s": "sh", "kh": "kh", "g": "gh", "j": "z", "ph": "f", "l": "l" },
  virama: "੍", nasals: "ਂੰ", addak: "ੱ",
};

// Spellings the rules can't guess (mostly short, very common words).
const COMMON: Record<string, string> = Object.fromEntries(Object.entries({
  "है": "hai", "हैं": "hain", "मैं": "main", "में": "mein", "यह": "yeh", "वह": "woh", "वो": "woh", "ये": "ye", "नहीं": "nahi", "नही": "nahi",
  "क्यों": "kyun", "क्यूँ": "kyun", "क्यूं": "kyun", "यूँ": "yun", "यूं": "yun", "हूँ": "hoon", "हूं": "hoon", "तू": "tu", "तो": "toh", "भी": "bhi", "ही": "hi",
  "कि": "ki", "की": "ki", "जी": "ji", "सी": "si", "सा": "sa", "दिल": "dil", "हम": "hum", "तुम": "tum", "ज़िंदगी": "zindagi", "ज़िन्दगी": "zindagi", "जिंदगी": "zindagi", "कहाँ": "kahan", "यहाँ": "yahan", "वहाँ": "wahan",
  "ਹੈ": "hai", "ਹੈਂ": "hain", "ਮੈਂ": "main", "ਨੂੰ": "nu", "ਤੂੰ": "tu", "ਨਹੀਂ": "nahi", "ਵੀ": "vi", "ਹੀ": "hi", "ਜੀ": "ji", "ਦੀ": "di", "ਦਾ": "da", "ਦੇ": "de", "ਕਿ": "ki", "ਜ਼ਿੰਦਗੀ": "zindagi", "ਜਿੰਦਗੀ": "zindagi",
}).map(([k, v]) => [k.normalize("NFC"), v]));

interface Unit { c: string; v: string; schwa: boolean; nasal: boolean }

function romanizeWord(word: string, s: Script) {
  word = word.normalize("NFC");
  if (COMMON[word]) return COMMON[word];
  const units: Unit[] = [];
  let geminate = false;
  for (const ch of word) {
    const last = units[units.length - 1];
    if (s.consonants[ch]) {
      let c = s.consonants[ch];
      if (geminate) { c = c[0] + c; geminate = false; }
      units.push({ c, v: "a", schwa: true, nasal: false });
    } else if (ch === s.nukta && last) last.c = s.nuktaForms[last.c] ?? last.c;
    else if (s.matras[ch] && last) { last.v = s.matras[ch]; last.schwa = false; }
    else if (ch === s.virama && last) { last.v = ""; last.schwa = false; }
    else if (s.vowels[ch]) units.push({ c: "", v: s.vowels[ch], schwa: false, nasal: false });
    else if (s.nasals.includes(ch) && last) last.nasal = true;
    else if (ch === s.visarga && last) last.v += "h";
    else if (ch === s.addak) geminate = true;
  }
  if (!units.length) return "";

  // Schwa deletion: drop the silent inherent "a" at the end of a word, and between
  // consonants when it sits in a vowel–consonant–[a]–consonant–vowel pattern ("kamala" -> "kamla").
  const lastUnit = units[units.length - 1];
  if (lastUnit.schwa && units.length > 1 && !lastUnit.nasal) lastUnit.v = "";
  for (let i = units.length - 2; i >= 1; i--) {
    const u = units[i], prev = units[i - 1], next = units[i + 1];
    if (u.schwa && !u.nasal && u.c && prev.v && next.c && next.v) u.v = "";
  }

  // Word-final long vowels are written short in Hinglish ("meri", "tera", "tu", "na").
  if (lastUnit.c === "w" && !lastUnit.v) lastUnit.c = "v"; // "chhaanv", "gaanv"
  if ((units.length > 1 || lastUnit.c) && !lastUnit.nasal) lastUnit.v = ({ aa: "a", ee: "i", oo: "u" } as Record<string, string>)[lastUnit.v] ?? lastUnit.v;

  return units.map((u, i) => {
    const next = units[i + 1];
    let v = u.v;
    // Glide between vowels: "gai" -> "gayi", "jaae" -> "jaaye", "kudiie" -> "kudiye".
    if (next && !next.c && !u.nasal) {
      if (v === "i" || v === "ee") v = "iy";
      else if ((v === "a" || v === "aa") && /^(e|i|ee)$/.test(next.v)) v += "y";
    }
    return u.c + v + (u.nasal ? (/^[pbm]/.test(next?.c ?? "") ? "m" : "n") : "");
  }).join("").replace(/chch/g, "ch");
}

const DEVANAGARI = /[ऀ-ॿ]+/g;
const GURMUKHI = /[਀-੿]+/g;

export const hasIndicScript = (text: string) => /[ऀ-ॿ਀-੿]/.test(text);
export const isLatinText = (text: string) => (text.match(/[A-Za-z]/g)?.length ?? 0) > (text.match(/[^\sA-Za-z\d\p{P}]/gu)?.length ?? 0);

export function romanize(text: string) {
  if (!hasIndicScript(text)) return text;
  return text
    .replace(/[०-९]/g, d => String(d.charCodeAt(0) - 0x966))
    .replace(/[੦-੯]/g, d => String(d.charCodeAt(0) - 0xA66))
    .replace(/[।॥]/g, " ")
    .replace(DEVANAGARI, word => romanizeWord(word, devanagari))
    .replace(GURMUKHI, word => romanizeWord(word, gurmukhi))
    .replace(/\s{2,}/g, " ")
    .trim();
}
