"""把 24 套家居服追加进服装库索引，并补齐英文标签。

用法：python scripts/append_homewear_catalog.py
库目录用 COMFY_LIBRARY 指定，默认插件的 library/。
可重复执行：已存在的 id 不会重复追加。
"""
import json, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from gen_homewear import ITEMS, LIB  # noqa: E402

INDEX = LIB / 'data' / 'costume-zh.json'
META = LIB / 'data' / 'meta-zh.json'
LABELS = LIB.parent / 'translations' / 'labels.en.json'

CAT_ALIAS = {'家居服春': '家居 春', '家居服夏': '家居 夏', '家居服秋': '家居 秋', '家居服冬': '家居 冬'}

EXTRA_LABELS = {
    '家居服春': 'Homewear Spring', '家居服夏': 'Homewear Summer',
    '家居服秋': 'Homewear Autumn', '家居服冬': 'Homewear Winter',
    '家居服': 'loungewear', '纯棉': 'cotton', '小翻领': 'notch collar', '睡衣': 'pajamas',
    '滚边': 'piping', '奶油白': 'cream white', '华夫格': 'waffle knit', '圆领': 'round neck',
    '浅粉': 'light pink', '针织': 'knit', '开衫': 'cardigan', '豆绿': 'sage green',
    '七分裤': 'capri pants', '小口袋': 'chest pocket', '燕麦': 'oatmeal', '法兰绒': 'flannel',
    '格纹': 'plaid', '浅蓝': 'light blue', '条纹': 'striped', '衬衫领': 'shirt collar',
    '薄荷绿': 'mint', '亚麻': 'linen', '棉麻': 'cotton linen', '淡紫': 'lilac',
    '焦糖': 'caramel', '棉质': 'cotton', '连帽': 'hooded', '卫衣': 'sweatshirt',
    '家居裤': 'jogger pants', '抽绳': 'drawstring', '豆沙粉': 'dusty pink', '绒面': 'velvet feel',
    '藏蓝': 'navy', '奶油': 'cream', '珊瑚绒': 'coral fleece', '翻领': 'collar',
    '加厚': 'thick', '米白': 'ivory', '摇粒绒': 'sherpa fleece', '深灰': 'dark grey',
    '加绒': 'fleece lined', '棕色': 'brown', '马甲': 'vest',
}


def row_for(item):
    kw = item['kw']
    cat = item['cat']
    alias = CAT_ALIAS[cat]
    search = ' '.join([item['id'].lower(), cat, alias, ' '.join(kw), item['en_kw']])
    return {
        'id': item['id'],
        '分类': cat,
        '关键词': kw,
        '英文关键词': item['en_kw'],
        '缩略图': f'thumbs/{item["id"]}.webp',
        '预览图': f'img/{item["id"]}.webp',
        '原图': f'png/{item["id"]}.png',
        '检索': search,
    }


def main():
    rows = json.loads(INDEX.read_text(encoding='utf-8'))
    have = {r.get('id') for r in rows}
    added = 0
    for item in ITEMS:
        if item['id'] in have:
            continue
        rows.append(row_for(item))
        added += 1
    INDEX.write_text(json.dumps(rows, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    counts = {}
    for r in rows:
        counts[r.get('分类', '')] = counts.get(r.get('分类', ''), 0) + 1
    META.write_text(json.dumps({'total': len(rows), 'categories': counts}, ensure_ascii=False, indent=2), encoding='utf-8')

    if LABELS.exists():
        labels = json.loads(LABELS.read_text(encoding='utf-8'))
    else:
        labels = {}
    for zh, en in EXTRA_LABELS.items():
        labels.setdefault(zh, en)
    LABELS.parent.mkdir(parents=True, exist_ok=True)
    LABELS.write_text(json.dumps(labels, ensure_ascii=False, indent=2), encoding='utf-8')

    print(json.dumps({'added': added, 'total': len(rows), 'lounge': counts.get('家居服春', 0) + counts.get('家居服夏', 0) + counts.get('家居服秋', 0) + counts.get('家居服冬', 0)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
