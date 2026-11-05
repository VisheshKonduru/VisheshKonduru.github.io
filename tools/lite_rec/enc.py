# python enc.py <framesdir> <demo> <file> <label> [order]
import sys, json, subprocess, glob, os
fr, demo, name, label = sys.argv[1:5]; order = int(sys.argv[5]) if len(sys.argv) > 5 else 0
FF = r"C:\VK\Resume\_video_tools\venv\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v9.0.2.exe"
OUT = r"C:\VK\Resume\portfolio-ui-b\assets\lite"; os.makedirs(OUT, exist_ok=True)
n = len(glob.glob(fr + "/f*.png")); T = n / 30; d = 0.6
inp = ["-framerate", "30", "-i", fr + "/f%04d.png"]
# seamless loop: the last d seconds dissolve into the first d seconds
vf = (f"[0]crop=iw:trunc(ih/2)*2:0:0,split[a][b];[a]trim={d}:{T},setpts=PTS-STARTPTS[m];[b]trim=0:{d},setpts=PTS-STARTPTS[s];"
      f"[m][s]xfade=transition=fade:duration={d}:offset={T-2*d:.3f},format=yuv420p[v]")
base = os.path.join(OUT, name)
run = lambda a: subprocess.run([FF, "-y", "-loglevel", "error", *inp, "-filter_complex", vf, "-map", "[v]", *a], check=True)
run(["-c:v", "libx264", "-preset", "slow", "-crf", "28", "-threads", "4", "-movflags", "+faststart", "-an", base + ".mp4"])
run(["-c:v", "libaom-av1", "-crf", "40", "-b:v", "0", "-cpu-used", "5", "-row-mt", "1", "-threads", "4", "-movflags", "+faststart", "-an", base + "_av1.mp4"])
subprocess.run([FF, "-y", "-loglevel", "error", "-i", base + ".mp4", "-frames:v", "1", "-q:v", "3", base + ".jpg"], check=True)
from PIL import Image
w, h = Image.open(base + ".jpg").size
mp = os.path.join(OUT, "loops.json"); man = json.load(open(mp)) if os.path.exists(mp) else {}
L = [l for l in man.get(demo, []) if l["file"] != name] + [dict(file=name, label=label, w=w, h=h, order=order)]
man[demo] = sorted(L, key=lambda l: l["order"])
json.dump(man, open(mp, "w"), indent=1)
for e in (".mp4", "_av1.mp4", ".jpg"): print(name + e, os.path.getsize(base + e) // 1024, "KB")
print(f"{T-d:.1f}s {w}x{h}")
