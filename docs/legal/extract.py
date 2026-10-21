"""Generate legal HTML data from the unmodified VV-163 DOCX attachments.
Run from any directory; --check verifies source fidelity without writing files.
"""
import json
from pathlib import Path
import re
import sys
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
W = '{' + NS['w'] + '}'
OLD_RATE = '1 Shards = 1,6 российского рубля'
NEW_RATE = '1 российский рубль = 1,6 Shards'


def extract(name):
    with ZipFile(ROOT / 'docs/legal/source' / (name + '.docx')) as archive:
        document = ET.fromstring(archive.read('word/document.xml'))
        numbering = ET.fromstring(archive.read('word/numbering.xml'))
    assert not document.findall('.//w:tbl', NS), 'Tables need an explicit renderer'
    blocks = []
    counts = {}
    corrections = 0
    for index, paragraph in enumerate(document.findall('w:body/w:p', NS)):
        text = ''.join(node.text or '' if node.tag == W + 't' else '\n' if node.tag in (W + 'br', W + 'cr') else '\t' if node.tag == W + 'tab' else '' for node in paragraph.iter())
        if name == 'terms' and OLD_RATE in text:
            assert text.startswith('6.3.')
            corrections += text.count(OLD_RATE)
            text = text.replace(OLD_RATE, NEW_RATE)
        num = paragraph.find('w:pPr/w:numPr', NS)
        if num is not None:
            level = num.find('w:ilvl', NS).get(W + 'val')
            assert level == '0', 'Nested lists need an explicit renderer'
            num_id = num.find('w:numId', NS).get(W + 'val')
            definition = numbering.find(f'w:num[@w:numId="{num_id}"]', NS)
            abstract_id = definition.find('w:abstractNumId', NS).get(W + 'val')
            level_definition = numbering.find(f'w:abstractNum[@w:abstractNumId="{abstract_id}"]/w:lvl[@w:ilvl="{level}"]', NS)
            assert level_definition.find('w:numFmt', NS).get(W + 'val') == 'decimal'
            assert definition.find('w:lvlOverride', NS) is None
            start = int(level_definition.find('w:start', NS).get(W + 'val'))
            value = counts.get(num_id, start - 1) + 1
            counts[num_id] = value
            if blocks and blocks[-1]['kind'] == 'list' and blocks[-1]['id'] == num_id:
                blocks[-1]['items'].append(text)
            else:
                blocks.append({'kind': 'list', 'id': num_id, 'start': value, 'items': [text]})
        else:
            kind = 'title' if index == 0 else 'revision' if index == 1 else 'heading' if re.match(r'^\d+\. [А-ЯЁ]', text) else 'paragraph'
            blocks.append({'kind': kind, 'text': text})
    assert corrections == (1 if name == 'terms' else 0)
    return blocks


for name in ('privacy', 'terms'):
    blocks = extract(name)
    result = json.dumps(blocks, ensure_ascii=False, indent=2) + '\n'
    output = ROOT / 'frontend/src/lib/legal' / (name + '.json')
    if '--check' in sys.argv:
        assert output.read_text() == result, f'{name}: generated data differs from source'
    else:
        output.write_text(result)
    paragraphs = sum(len(block['items']) if block['kind'] == 'list' else 1 for block in blocks)
    print(f'{name}: {paragraphs} paragraphs preserved; {sum(b["kind"] == "list" for b in blocks)} ordered lists')
