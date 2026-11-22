"""
How the monk pronounces names and terms the English G2P doesn't know.

Phonemes use Kokoro/misaki's American set (ˈ primary, ˌ secondary stress; A=ay, I=eye,
O=oh, W=ow; ʤ=j, ʧ=ch, ɹ=r). Aim: how a careful English-speaking teacher says them.
Each entry matches with or without diacritics, any case.
"""

import re
import unicodedata

LEXICON = {
    "Nāgārjuna": "nɑɡˈɑɹʤunə",
    "Candrakīrti": "ʧˌɑndɹəkˈɪɹti",
    "Chandrakirti": "ʧˌɑndɹəkˈɪɹti",
    "Madhyamaka": "mˌɑdjəmˈɑkə",
    "Mādhyamika": "mɑdjˈɑmɪkə",
    "Mūlamadhyamakakārikā": "mˌuləmˌɑdjəməkəkˈɑɹɪkə",
    "prasaṅga": "pɹəsˈɑŋɡə",
    "Prāsaṅgika": "pɹɑsˈɑŋɡɪkə",
    "Svātantrika": "svɑtˈɑntɹɪkə",
    "śūnyatā": "ʃˈunjətˌɑ",
    "saṃsāra": "səmsˈɑɹə",
    "nirvāṇa": "nəɹvˈɑnə",
    "svabhāva": "svəbˈɑvə",
    "catuṣkoṭi": "ʧˌɑtʊʃkˈOti",
    "tathāgata": "tətˈɑɡətə",
    "skandha": "skˈɑndə",
    "skandhas": "skˈɑndəz",
    "dukkha": "dˈʊkə",
    "sutta": "sˈʊtə",
    "sūtra": "sˈutɹə",
    "Vimalakīrti": "vˌɪməlɑkˈiɹti",
    "Mañjuśrī": "mˌɑnʤuʃɹˈi",
    "Kaccānagotta": "kˌɑʧɑnəɡˈOtə",
    "Milinda": "mɪlˈɪndə",
    "Nāgasena": "nˌɑɡəsˈAnə",
    "Gautama": "ɡˈWtəmə",
    "Āryadeva": "ˌɑɹjədˈAvə",
    "Bhāviveka": "bˌɑvivˈAkə",
    "Buddhapālita": "bˌʊdəpˈɑlɪtə",
    "Tsongkhapa": "sˈɔŋkəpə",
    "Advaita": "ədvˈItə",
    "Vedānta": "vədˈɑntə",
    "Ātman": "ˈɑtmən",
    "Brahman": "bɹˈɑmən",
    "ensō": "ˈɛnsO",
    "koan": "kˈOɑn",
}


def _fold(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c)).lower()


_BY_FOLDED = {_fold(k): v for k, v in LEXICON.items()}
_WORD = re.compile(r"[^\W\d_]+")


def apply(text: str) -> str:
    """Wrap known words in misaki's [word](/phonemes/) syntax."""

    def sub(m: re.Match) -> str:
        ps = _BY_FOLDED.get(_fold(m.group(0)))
        return f"[{m.group(0)}](/{ps}/)" if ps else m.group(0)

    return _WORD.sub(sub, text)
