"""Conservative cleanup of old Windows temporary data, explicitly requested by the user."""
import argparse, ctypes, json, os, re, shutil, time
from pathlib import Path
project=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
cutoff=time.time()-7*86400
file_cutoff=time.time()-2*3600
roots=[]
for raw in [str(Path(os.environ['USERPROFILE'])/'AppData/Local/Temp'),os.environ.get('TEMP'),str(Path(os.environ.get('WINDIR','C:/Windows'))/'Temp')]:
    if raw:
        p=Path(raw).resolve()
        if p.exists() and p not in roots: roots.append(p)
extensions={'.tmp','.temp','.log','.dmp','.etl','.old'}
protected={'.doc','.docx','.xls','.xlsx','.ppt','.pptx','.pdf','.png','.jpg','.jpeg','.webp','.mp3','.flac','.m4a','.wav','.mp4','.zip','.rar','.7z','.asd','.wbk','.exe','.dll','.node','.ps1','.py','.js','.ts'}
directory_pattern=re.compile(r'^(scoped_dir|chrome[_-]|chromium[_-]|\.org\.chromium\.|playwright[_-]|puppeteer[_-]|pip[-_]|npm[-_]|uv[-_]|tmp[a-z0-9_-]{4,}$|\{?[a-f0-9]{8}-[a-f0-9-]{27,}\}?$)',re.I)
preserve_prefix=('codex','openai','chatgpt','attachment','clipboard','unsaved','recovery','autorecover','office','mpcmdrun','mpsigstub','defender','security','audit','~')
def linked(p):
    return p.is_symlink() or (hasattr(os.path,'isjunction') and os.path.isjunction(p))
def allowed_path(p,root):
    try: return p.resolve()!=root and p.resolve().is_relative_to(root) and not linked(p)
    except OSError:return False
def inspect(p,root):
    if not allowed_path(p,root) or p.name.lower().startswith(preserve_prefix):return None
    try:
        if p.is_file():
            if p.suffix.lower() not in extensions or p.stat().st_mtime>=file_cutoff:return None
            return {'path':str(p),'root':str(root),'directory':False,'bytes':p.stat().st_size}
        if not p.is_dir() or p.stat().st_mtime>=cutoff or not directory_pattern.match(p.name):return None
        size=0
        for base,dirs,files in os.walk(p,followlinks=False):
            for n in dirs+files:
                child=Path(base)/n
                if not allowed_path(child,root) or child.stat().st_mtime>=cutoff or child.name.lower().startswith(preserve_prefix):return None
                if child.is_file():
                    if child.suffix.lower() in protected:return None
                    size+=child.stat().st_size
        return {'path':str(p),'root':str(root),'directory':True,'bytes':size}
    except (OSError,PermissionError):return None
plan=[]
for root in roots:
    try:
        for p in root.iterdir():
            entry=inspect(p,root)
            if entry:plan.append(entry)
    except (OSError,PermissionError):pass
report={'roots':[str(p) for p in roots],'fileMinimumAgeHours':2,'directoryMinimumAgeDays':7,'candidates':plan,'candidateBytes':sum(x['bytes'] for x in plan)}
(project/'artifacts/windows-temp-plan.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
if args.apply:
    removed=[];skipped=[]
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateFileW.argtypes=[ctypes.c_wchar_p,ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p,ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p]
    kernel.CreateFileW.restype=ctypes.c_void_p
    kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    def unused(p):
        handle=kernel.CreateFileW(str(p),0x80000000,0,None,3,0x00200000,None)
        if handle==ctypes.c_void_p(-1).value:return False
        kernel.CloseHandle(handle);return True
    for candidate in plan:
        p=Path(candidate['path']);root=Path(candidate['root'])
        # Recheck resolved boundaries, age and every descendant immediately before deletion.
        current=inspect(p,root)
        if not current or current['bytes']!=candidate['bytes']:
            skipped.append({'path':str(p),'reason':'changed since scan'});continue
        try:
            files=[Path(base)/n for base,_,names in os.walk(p) for n in names] if current['directory'] else [p]
            if not all(unused(f) for f in files):
                skipped.append({'path':str(p),'reason':'in use or inaccessible'});continue
            if current['directory']:shutil.rmtree(p)
            else:p.unlink()
            removed.append(current)
        except OSError as error:skipped.append({'path':str(p),'reason':type(error).__name__})
    report.update({'removed':removed,'removedBytes':sum(x['bytes'] for x in removed),'skipped':skipped})
    (project/'artifacts/windows-temp-cleanup.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'removedItems':len(removed),'removedBytes':report['removedBytes'],'skippedItems':len(skipped)},ensure_ascii=False))
else:
    print(json.dumps({'candidateItems':len(plan),'candidateBytes':report['candidateBytes'],'fileMinimumAgeHours':2,'directoryMinimumAgeDays':7,'roots':report['roots']},ensure_ascii=False))
