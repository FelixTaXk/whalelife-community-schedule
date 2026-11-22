"""LEGACY: 旧版白色无脸人台生成脚本，仅留档。

现行 24 套 HOM 已改为与上游一致的 ghost mannequin（浅灰棚、无头无手、衣物中空），
不要直接用本脚本覆盖 library/png|img|thumbs/HOM-*；旧图备份在 .backup/homewear-v1/。
"""
import json, os, time, urllib.request, shutil
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent
# 默认直接写进插件自带的服装库；换库用 COMFY_LIBRARY，ComfyUI 输出目录用 COMFY_OUTPUT。
LIB = Path(os.environ.get('COMFY_LIBRARY') or (PLUGIN / 'library')).resolve()
OUT_ROOT = Path(os.environ.get('COMFY_OUTPUT') or (PLUGIN / '.comfy-output')).resolve()
API = os.environ.get('COMFYUI_URL', 'http://127.0.0.1:8188').rstrip('/')
CKPT = os.environ.get('COMFY_CKPT', 'majicmixRealistic_v7.safetensors')

NEG = ('(real person:1.5), (human:1.5), woman, girl, lady, face, eyes, mouth, lips, hair, makeup, skin, '
       'hands, skirt, high heels, bag, necklace, crop top, midriff, cleavage, sheer fabric, silk, satin, '
       'shoes, sneakers, slippers, socks, logo, letters, text, watermark, blurry, low quality, deformed, '
       'floor lamp, pole, clothes rack, hanger, hood up, two mannequins, multiple mannequins, duplicate, '
       'second mannequin, glowing floor, props')

BASE = ('one single white plastic faceless mannequin, centered, with completely blank smooth head, '
        'no facial features, no hair, full body, barefoot, wearing {outfit}, '
        'standing on a white platform, plain light grey empty studio background, '
        'front view, e-commerce product photo, high detail, no shoes')

ITEMS = [
    # 春
    dict(id='HOM-0001', cat='家居服春', kw=['浅灰','纯棉','小翻领','长袖','睡衣','长裤','滚边'],
         en_kw='light grey cotton notch collar long sleeve pajama pants piping',
         outfit='a light grey cotton pajama set, notch collar with dark grey piping, chest pocket, long sleeve top and straight pants'),
    dict(id='HOM-0002', cat='家居服春', kw=['奶油白','华夫格','圆领','长袖','家居服','长裤'],
         en_kw='cream waffle knit round neck long sleeve loungewear pants',
         outfit='a cream white waffle knit long sleeve top and matching straight pants, round neck lounge set'),
    dict(id='HOM-0003', cat='家居服春', kw=['浅粉','针织','开衫','圆领','家居服','长裤'],
         en_kw='light pink knit cardigan round neck loungewear pants',
         outfit='a light pink knit cardigan over a matching round neck long sleeve top and knit pants'),
    dict(id='HOM-0004', cat='家居服春', kw=['豆绿','纯棉','短袖','家居服','七分裤','小口袋'],
         en_kw='sage green cotton short sleeve loungewear capri pants pocket',
         outfit='a sage green cotton short sleeve top with a small chest pocket and matching capri pants'),
    dict(id='HOM-0005', cat='家居服春', kw=['燕麦','法兰绒','格纹','长袖','睡衣','长裤'],
         en_kw='oatmeal flannel plaid long sleeve pajama pants',
         outfit='an oatmeal beige flannel plaid long sleeve pajama top and matching straight pants'),
    dict(id='HOM-0006', cat='家居服春', kw=['浅蓝','条纹','衬衫领','长袖','睡衣','长裤'],
         en_kw='light blue striped shirt collar long sleeve pajama pants',
         outfit='a light blue and white striped cotton pajama set with shirt collar, long sleeve top and straight pants'),
    # 夏
    dict(id='HOM-0007', cat='家居服夏', kw=['白色','纯棉','短袖','睡衣','短裤','滚边'],
         en_kw='white cotton short sleeve pajama shorts piping',
         outfit='a white cotton short sleeve pajama top with notch collar and piping, matching shorts'),
    dict(id='HOM-0008', cat='家居服夏', kw=['薄荷绿','纯棉','短袖','家居服','短裤'],
         en_kw='mint cotton short sleeve loungewear shorts',
         outfit='a mint green cotton short sleeve top and matching loose shorts'),
    dict(id='HOM-0009', cat='家居服夏', kw=['浅蓝','亚麻','短袖','家居服','短裤'],
         en_kw='light blue linen short sleeve loungewear shorts',
         outfit='a light blue linen short sleeve top and matching shorts, relaxed summer lounge set'),
    dict(id='HOM-0010', cat='家居服夏', kw=['米色','棉麻','短袖','家居服','七分裤'],
         en_kw='beige cotton linen short sleeve loungewear capri pants',
         outfit='a beige cotton linen short sleeve top and matching capri pants'),
    dict(id='HOM-0011', cat='家居服夏', kw=['浅灰','条纹','短袖','睡衣','短裤'],
         en_kw='light grey striped short sleeve pajama shorts',
         outfit='a light grey and white striped cotton short sleeve pajama top and matching shorts'),
    dict(id='HOM-0012', cat='家居服夏', kw=['淡紫','纯棉','圆领','短袖','家居服','短裤'],
         en_kw='lilac cotton round neck short sleeve loungewear shorts',
         outfit='a lilac cotton round neck short sleeve top and matching shorts'),
    # 秋
    dict(id='HOM-0013', cat='家居服秋', kw=['燕麦','针织','开衫','长袖','家居服','长裤'],
         en_kw='oatmeal knit cardigan long sleeve loungewear pants',
         outfit='an oatmeal knit cardigan over a matching long sleeve top and straight knit pants'),
    dict(id='HOM-0014', cat='家居服秋', kw=['焦糖','法兰绒','格纹','长袖','睡衣','长裤'],
         en_kw='caramel flannel plaid long sleeve pajama pants',
         outfit='a caramel brown flannel plaid long sleeve pajama top and matching straight pants'),
    dict(id='HOM-0015', cat='家居服秋', kw=['灰色','棉质','连帽','卫衣','家居裤','抽绳'],
         en_kw='grey cotton hooded sweatshirt jogger pants drawstring',
         outfit='a grey cotton hooded sweatshirt with the hood down and matching drawstring jogger pants'),
    dict(id='HOM-0016', cat='家居服秋', kw=['豆沙粉','绒面','长袖','家居服','长裤'],
         en_kw='dusty pink velvet feel long sleeve loungewear pants',
         outfit='a dusty pink soft velvet feel long sleeve lounge top and matching pants'),
    dict(id='HOM-0017', cat='家居服秋', kw=['藏蓝','针织','开衫','长袖','家居服','长裤'],
         en_kw='navy knit cardigan long sleeve loungewear pants',
         outfit='a navy blue knit cardigan over a matching long sleeve top and knit pants'),
    dict(id='HOM-0018', cat='家居服秋', kw=['奶油','纯棉','小翻领','长袖','睡裙','及踝'],
         en_kw='cream cotton notch collar long sleeve ankle length nightgown',
         outfit='a cream cotton long sleeve ankle length nightgown with a small notch collar and pink piping'),
    # 冬
    dict(id='HOM-0019', cat='家居服冬', kw=['浅粉','珊瑚绒','翻领','长袖','睡衣','长裤'],
         en_kw='light pink coral fleece collar long sleeve pajama pants',
         outfit='a light pink thick coral fleece pajama set with a soft collar, long sleeve top and matching pants'),
    dict(id='HOM-0020', cat='家居服冬', kw=['灰色','加厚','法兰绒','格纹','睡衣','长裤'],
         en_kw='grey thick flannel plaid pajama pants',
         outfit='a grey thick flannel plaid pajama top and matching warm pants'),
    dict(id='HOM-0021', cat='家居服冬', kw=['米白','摇粒绒','圆领','长袖','家居服','长裤'],
         en_kw='ivory sherpa fleece round neck long sleeve loungewear pants',
         outfit='an ivory sherpa fleece long sleeve top and matching thick pants'),
    dict(id='HOM-0022', cat='家居服冬', kw=['深灰','加绒','连帽','卫衣','家居裤','抽绳'],
         en_kw='dark grey fleece hooded sweatshirt jogger pants drawstring',
         outfit='a dark grey thick fleece hooded sweatshirt with the hood down and matching drawstring jogger pants'),
    dict(id='HOM-0023', cat='家居服冬', kw=['棕色','针织','马甲','长袖','家居服','长裤'],
         en_kw='brown knit vest long sleeve loungewear pants',
         outfit='a brown knit vest over a cream long sleeve top and matching knit pants'),
    dict(id='HOM-0024', cat='家居服冬', kw=['浅蓝','珊瑚绒','翻领','长袖','睡衣','长裤'],
         en_kw='light blue coral fleece collar long sleeve pajama pants',
         outfit='a light blue thick coral fleece pajama set with a soft collar, long sleeve top and matching pants'),
]


def post(path, payload):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(API + path, data=data, headers={'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=60).read().decode('utf-8'))


def get(path):
    return json.loads(urllib.request.urlopen(API + path, timeout=60).read().decode('utf-8'))


def graph_for(item, index):
    import os
    seed_offset = int(os.environ.get('HOM_SEED_OFFSET', '0'))
    pos = BASE.format(outfit=item['outfit'])
    return {
        '1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': CKPT}},
        '2': {'class_type': 'CLIPTextEncode', 'inputs': {'text': pos, 'clip': ['1', 1]}},
        '3': {'class_type': 'CLIPTextEncode', 'inputs': {'text': NEG, 'clip': ['1', 1]}},
        '4': {'class_type': 'EmptyLatentImage', 'inputs': {'width': 512, 'height': 768, 'batch_size': 1}},
        '5': {'class_type': 'KSampler', 'inputs': {'seed': 810000 + index + seed_offset, 'steps': 30, 'cfg': 7.5,
            'sampler_name': 'dpmpp_2m', 'scheduler': 'karras', 'denoise': 1.0, 'model': ['1', 0],
            'positive': ['2', 0], 'negative': ['3', 0], 'latent_image': ['4', 0]}},
        '6': {'class_type': 'VAEDecode', 'inputs': {'samples': ['5', 0], 'vae': ['1', 2]}},
        '7': {'class_type': 'SaveImage', 'inputs': {'filename_prefix': 'homewear/' + item['id'], 'images': ['6', 0]}},
    }


def wait_for(pid, timeout=240):
    deadline = time.time() + timeout
    while time.time() < deadline:
        hist = get('/history/' + pid)
        if pid in hist:
            entry = hist[pid]
            if entry.get('status', {}).get('status_str') == 'success':
                return entry
            raise RuntimeError('job failed: ' + json.dumps(entry.get('status', {}), ensure_ascii=False)[:400])
        time.sleep(2)
    raise TimeoutError(pid)


def main():
    import sys
    force = '--force' in sys.argv
    only = {arg for arg in sys.argv[1:] if arg.startswith('HOM-')}
    done, failed = [], []
    for idx, item in enumerate(ITEMS, start=1):
        iid = item['id']
        if only and iid not in only:
            continue
        if (LIB / 'png' / (iid + '.png')).exists() and not force:
            print(iid, 'skip existing', flush=True)
            done.append(iid)
            continue
        try:
            pid = post('/prompt', {'prompt': graph_for(item, idx), 'client_id': 'wardrobe-home'})['prompt_id']
            entry = wait_for(pid)
            img = entry['outputs']['7']['images'][0]
            src = OUT_ROOT / img.get('subfolder', '') / img['filename']
            shutil.copy2(src, LIB / 'png' / (iid + '.png'))

            im = Image.open(src).convert('RGB')
            pv = im.copy(); pv.thumbnail((800, 1000), Image.LANCZOS)
            pv.save(LIB / 'img' / (iid + '.webp'), 'WEBP', quality=88, method=6)
            th = im.copy(); th.thumbnail((400, 500), Image.LANCZOS)
            th.save(LIB / 'thumbs' / (iid + '.webp'), 'WEBP', quality=82, method=6)
            print(iid, 'ok', im.size, flush=True)
            done.append(iid)
        except Exception as exc:
            print(iid, 'FAIL', repr(exc), flush=True)
            failed.append(iid)
    print(json.dumps({'done': len(done), 'failed': failed}, ensure_ascii=False))


if __name__ == '__main__':
    main()
