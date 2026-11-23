"""Persistent client for the official Chrome DevTools MCP server; one approval per session."""
import json, os, queue, subprocess, sys, threading
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
project = Path(__file__).resolve().parents[1]
port, endpoint = (Path(os.environ['LOCALAPPDATA'])/'Google/Chrome/User Data/DevToolsActivePort').read_text().splitlines()[:2]
proc = subprocess.Popen(['cmd.exe','/d','/c','npx.cmd','-y','chrome-devtools-mcp@latest','--autoConnect','--categoryExtensions','--no-usage-statistics','--workspace',str(project)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW)
replies = queue.Queue()
def reader():
    for line in proc.stdout:
        try: replies.put(json.loads(line))
        except ValueError: pass
threading.Thread(target=reader,daemon=True).start()
def send(data):
    proc.stdin.write(json.dumps(data)+'\n'); proc.stdin.flush()
def request(i, method, params):
    send({'jsonrpc':'2.0','id':i,'method':method,'params':params})
    while True:
        r = replies.get(timeout=90)
        if r.get('id') == i: return r
try:
    request(1,'initialize',{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'volna-install','version':'1.0'}})
    send({'jsonrpc':'2.0','method':'notifications/initialized'})
    print('READY',flush=True)
    for i,line in enumerate(sys.stdin,2):
        if line.strip() == 'exit': break
        try:
            r = request(i,'tools/call',json.loads(line))
            for c in r.get('result',{}).get('content',[]):
                if c.get('type') == 'text': print(c['text'],flush=True)
            if r.get('error'): print(json.dumps(r['error']),flush=True)
        except Exception as e: print(type(e).__name__+': '+str(e),flush=True)
        print('READY',flush=True)
finally:
    proc.stdin.close()
    try: proc.wait(timeout=3)
    except subprocess.TimeoutExpired: proc.terminate()


