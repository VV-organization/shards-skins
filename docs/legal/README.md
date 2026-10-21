# Legal source provenance

Original DOCX attachments supplied in Linear VV-163 and retained without modification.

| Source | SHA-256 |
| --- | --- |
| `privacy.docx` | `fe04eb8a842a49013558c504d888c5273b1bb9aacbecc01f22608fcb2fcc81db` |
| `terms.docx` | `77a55802b06c8af6e232957c3699c15b84dee495e041a3b94329989f4cc207d3` |

The HTML pages render static JSON extracted from DOCX XML with Python standard-library `zipfile` and `ElementTree`; no document macros or embedded code are executed.

The only authorized textual change is in terms clause 6.3: `1 Shards = 1,6 российского рубля` becomes `1 российский рубль = 1,6 Shards`. This correction applies only to the HTML data. The original DOCX is unchanged, and no revised DOCX is created.

All 72 privacy paragraphs and 83 terms paragraphs remain in source order, including the empty trailing paragraphs. The six privacy and seven terms numbered lists preserve decimal numbering. The six explicit line breaks in the terms company-details paragraph remain as newlines rendered with `white-space: pre-wrap`. Headings are inferred from the title and numbered section headings; source documents use Normal paragraph styling.

Regenerate: `python3 docs/legal/extract.py`. Verify source fidelity without changes: `python3 docs/legal/extract.py --check`. The extractor rejects unhandled tables, nested lists, numbering overrides, and unexpected rate-correction counts.

Footer payment logos are the public `payments/mir.svg` and `payments/sbp.svg` assets read from the sibling Frags repository. No adjacent secrets, environment files, production data, Git metadata, or deployment configuration were copied.
