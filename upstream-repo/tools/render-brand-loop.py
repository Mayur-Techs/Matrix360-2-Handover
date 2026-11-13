"""Render the original, silent Matrix360 teal-light background using FFmpeg."""
import argparse
import pathlib
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--ffmpeg', default=shutil.which('ffmpeg'), help='Path to an FFmpeg executable')
args = parser.parse_args()
if not args.ffmpeg:
    parser.error('FFmpeg is required only to regenerate the committed video; use --ffmpeg PATH.')

root = pathlib.Path(__file__).resolve().parents[1]
assets = root / 'workstreams/avinash/frontend/frontend-source'
encoder = args.ffmpeg
# Periodic fields make the first and last frames join without a jump.
glow = "exp(-pow((X/W-.65-.15*sin(2*PI*T/12))*3,2)-pow((Y/H-.5-.22*cos(2*PI*T/12))*2,2))"
ribbon = "exp(-pow((Y/H-.48-.16*sin(X/W*5+2*PI*T/12))*16,2))"
field = f"geq=r='5+10*{glow}+10*{ribbon}':g='20+70*{glow}+35*{ribbon}':b='27+65*{glow}+27*{ribbon}'"
output = assets / 'matrix360-brand-loop.mp4'
subprocess.run([encoder, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
                f'nullsrc=s=960x540:r=24:d=12,{field},format=yuv420p', '-an', '-c:v', 'libx264',
                '-preset', 'fast', '-crf', '23', '-movflags', '+faststart', str(output)], check=True)
subprocess.run([encoder, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(output),
                '-frames:v', '1', str(assets / 'matrix360-brand-poster.jpg')], check=True)
print(f'Rendered {output.name}: {output.stat().st_size:,} bytes')
