"""Install and inspect VOLNA through the official Chrome DevTools MCP server."""
import json, os, queue, re, subprocess, sys, threading
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
project=Path(__file__).resolve().parents[1]
with open(Path(os.environ['LOCALAPPDATA'])/'Google/Chrome/User Data/DevToolsActivePort',encoding='utf-8') as f:
    port,endpoint=f.read().splitlines()[:2]
proc=subprocess.Popen(['cmd.exe','/d','/c','npx.cmd','-y','chrome-devtools-mcp@latest','--autoConnect','--categoryExtensions','--no-usage-statistics','--workspace',str(project)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW)
replies=queue.Queue()
def reader():
    for line in proc.stdout:
        try: replies.put(json.loads(line))
        except ValueError: pass
threading.Thread(target=reader,daemon=True).start()
def send(m):proc.stdin.write(json.dumps(m)+'\n');proc.stdin.flush()
def request(i,method,params):
    send({'jsonrpc':'2.0','id':i,'method':method,'params':params})
    while True:
        r=replies.get(timeout=90)
        if r.get('id')==i:return r
def call(i,name,args):
    r=request(i,'tools/call',{'name':name,'arguments':args})
    for c in r.get('result',{}).get('content',[]):
        if c.get('type')=='text':print(c['text'],flush=True)
    if r.get('error') or r.get('result',{}).get('isError'):raise RuntimeError(r)
    return r
try:
    request(1,'initialize',{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'volna-install','version':'1.0'}})
    send({'jsonrpc':'2.0','method':'notifications/initialized'})
    if '--schema' in sys.argv:
        schema=request(90,'tools/list',{})
        for tool in schema.get('result',{}).get('tools',[]):
            if tool['name'] in ['evaluate_script','take_snapshot','list_console_messages','reload_extension','select_page','take_screenshot']:
                print(json.dumps(tool,ensure_ascii=False))
        raise SystemExit(0)
    print('Connecting to Chrome. Allow the DevTools connection if Chrome asks.',flush=True)
    if '--library-status' in sys.argv:
        extension_id='ckdhkmhhdinbgdmegihlgjpdnploakkd'
    elif '--verify' in sys.argv:
        extension_id='ckdhkmhhdinbgdmegihlgjpdnploakkd'
        r=call(91,'list_pages',{})
        existing_text=' '.join(c.get('text','') for c in r.get('result',{}).get('content',[]))
        existing=re.search(r'^(\d+):[^\n]*chrome-extension://'+extension_id+r'/popup.html',existing_text,re.M)
        if not existing:
            r=call(92,'new_page',{'url':f'chrome-extension://{extension_id}/popup.html'})
            existing_text=' '.join(c.get('text','') for c in r.get('result',{}).get('content',[]))
            existing=re.search(r'^(\d+):[^\n]*chrome-extension://'+extension_id+r'/popup.html',existing_text,re.M)
        r=call(93,'evaluate_script',{'pageId':int(existing.group(1)),'function':"async () => {const until=Date.now()+20000;do {const s=await chrome.runtime.sendMessage({type:'GET_STATE'});if(!s.data.jobs.some(j=>['queued','running','packing'].includes(j.status)))return {idle:true};await new Promise(r=>setTimeout(r,500));}while(Date.now()<until);return {idle:false};}"})
        if not any('"idle":true' in c.get('text','').replace(' ','') for c in r.get('result',{}).get('content',[])):
            raise RuntimeError('An active download is still running; extension reload postponed.')
        call(2,'reload_extension',{'id':extension_id})
    else:
        r=call(2,'install_extension',{'path':str(project/'dist')})
        text=' '.join(c.get('text','') for c in r.get('result',{}).get('content',[]))
        match=re.search(r'Id:\s*([a-p]{32})',text)
        if not match:raise RuntimeError('Chrome did not return an extension ID')
        extension_id=match.group(1)
    (project/'artifacts/installed-extension.json').write_text(json.dumps({'id':extension_id,'version':'1.0.0','verifiedBy':'Chrome DevTools MCP install_extension + list_extensions'},ensure_ascii=False,indent=2),encoding='utf-8')
    call(3,'list_extensions',{})
    r=request(4,'tools/call',{'name':'list_pages','arguments':{}})
    page_text=' '.join(c.get('text','') for c in r.get('result',{}).get('content',[]))
    page_match=re.search(r'^(\d+):[^\n]*chrome-extension://'+extension_id+r'/popup.html',page_text,re.M)
    if not page_match or '--setup-library' in sys.argv:
        suffix='?view=settings&folder=connect' if '--setup-library' in sys.argv else ''
        r=call(40,'new_page',{'url':f'chrome-extension://{extension_id}/popup.html'+suffix})
        page_text=' '.join(c.get('text','') for c in r.get('result',{}).get('content',[]))
        page_match=re.search(r'^(\d+):[^\n]*chrome-extension://'+extension_id+r'/popup.html',page_text,re.M)
    page_id=int(page_match.group(1))
    call(5,'evaluate_script',{'pageId':page_id,'waitForStableDom':False,'function':"async () => { await document.fonts.ready; const state = await chrome.runtime.sendMessage({type:'GET_STATE'}); const page = await chrome.runtime.sendMessage({type:'PAGE'}); return { title:document.title, extensionId:chrome.runtime.id, version:chrome.runtime.getManifest().version, headline:document.querySelector('h1')?.textContent, textFont:document.fonts.check('14px \\\"YS Text\\\"'), headlineFont:document.fonts.check('700 42px \\\"YS Music\\\"'), stateOK:state.ok, pageConnected:!!page.data, collectionKind:page.data?.collection?.kind, visibleTracks:page.data?.collection?.tracks?.length, permissions:chrome.runtime.getManifest().permissions }; }"})
    music_match=re.search(r'^(\d+):[^\n]*https://music.yandex.kz/',page_text,re.M)
    if music_match:
        call(6,'evaluate_script',{'pageId':int(music_match.group(1)),'waitForStableDom':False,'function':"() => ({downloadButtons:document.querySelectorAll('[data-volna-track]').length,playerButtons:document.querySelectorAll('[data-volna-player]').length,toolbars:[...document.querySelectorAll('[data-volna]')].filter(e=>e.shadowRoot?.textContent?.includes('Скачать «Мне нравится»')).length,duplicateRows:[...document.querySelectorAll('[class*=HorizontalCardContainer_root]')].filter(e=>e.querySelectorAll(':scope > [data-volna-track]').length>1).length})"})
    call(7,'list_console_messages',{'pageId':page_id,'types':['error','warn']})
    if '--dedup-test' in sys.argv:
        result=call(77,'evaluate_script',{'pageId':page_id,'function':"async () => {const before=await chrome.runtime.sendMessage({type:'GET_STATE'}); if(before.data.jobs.some(j=>['queued','running','packing'].includes(j.status)))return {tested:false,reason:'User download is active'};const previous=[...before.data.jobs].reverse().find(j=>j.kind==='page'&&j.items.some(i=>i.status==='complete'&&i.folderSaved));if(!previous)return {tested:false,reason:'No folder-saved track'};const track=previous.items[0].track;const r=await chrome.runtime.sendMessage({type:'ENQUEUE',title:track.title,kind:'page',tracks:[track],settings:{...before.data.settings,zip:false}});if(r.ok)await chrome.runtime.sendMessage({type:'CANCEL_JOB',id:r.data});const after=await chrome.runtime.sendMessage({type:'GET_STATE'});return {tested:true,title:track.title,blocked:!r.ok&&r.error?.includes('уже есть в папке'),error:r.error,jobsBefore:before.data.jobs.length,jobsAfter:after.data.jobs.length,folder:await chrome.runtime.sendMessage({type:'LIBRARY_STATUS'})};}"})
        (project/'artifacts/live-dedup.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    if '--library-status' in sys.argv:
        call(76,'evaluate_script',{'pageId':page_id,'function':"async () => ({status:await chrome.runtime.sendMessage({type:'LIBRARY_STATUS'}),folderUI:document.querySelector('.library-settings')?.textContent})"})
    if '--setup-library' in sys.argv:
        call(74,'evaluate_script',{'pageId':page_id,'function':"async () => ({pickerAvailable:typeof showDirectoryPicker==='function',status:await chrome.runtime.sendMessage({type:'LIBRARY_STATUS'}),chooseButton:[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Выбрать папку «Треки»'))})"})
        call(75,'take_screenshot',{'pageId':page_id,'filePath':str(project/'artifacts/library-setup.png')})
    if '--oneclick-test' in sys.argv and music_match:
        call(71,'evaluate_script',{'pageId':page_id,'function':"async () => {const s=await chrome.runtime.sendMessage({type:'GET_STATE'}); window.__volnaTestBefore=s.data.jobs.map(j=>j.id); return {active:s.data.jobs.filter(j=>['queued','running','packing'].includes(j.status)).length};}"})
        call(72,'evaluate_script',{'pageId':int(music_match.group(1)),'function':"async () => {const h=document.querySelector('[data-volna-player]'); const b=h?.shadowRoot.querySelector('button'); if(!b || b.disabled) return {clicked:false,busy:!!b?.disabled}; b.click(); await new Promise(r=>setTimeout(r,400)); return {clicked:true,dialogOpen:!!document.querySelector('#volna-overlay')?.shadowRoot.querySelector('dialog[open]'),circularProgress:!!b.querySelector('[role=progressbar]')};}"})
        result=call(73,'evaluate_script',{'pageId':page_id,'function':"async () => {const until=Date.now()+20000; let s,j; do {s=await chrome.runtime.sendMessage({type:'GET_STATE'}); j=s.data.jobs.find(j=>!window.__volnaTestBefore.includes(j.id)); if(j&&!['queued','running','packing'].includes(j.status)) break; await new Promise(r=>setTimeout(r,500));}while(Date.now()<until); if(!j)return {created:false};const id=j.items[0]?.downloadId,d=id?(await chrome.downloads.search({id}))[0]:null; return {created:true,title:j.title,status:j.status,trackNumber:j.trackNumber,zip:j.settings.zip,error:j.items[0]?.error,catalogDurationMs:j.items[0]?.track.duration,download:d?{state:d.state,exists:d.exists,filename:d.filename,bytes:d.bytesReceived}:null};}"})
        (project/'artifacts/live-oneclick.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    if '--download-test' in sys.argv:
        result=call(8,'evaluate_script',{'pageId':page_id,'waitForStableDom':False,'function':"async () => { const state=await chrome.runtime.sendMessage({type:'GET_STATE'}); const page=await chrome.runtime.sendMessage({type:'PAGE'}); const track=page.data?.collection?.tracks?.[0]; if(!track) throw Error('No visible track'); const queued=await chrome.runtime.sendMessage({type:'ENQUEUE',title:'Проверка VOLNA',kind:'page',tracks:[track],settings:{...state.data.settings,format:'mp3',zip:false,lyricsFile:false,lyricsTags:false}}); if(!queued.ok) throw Error(queued.error); return {jobId:queued.data,tokenPresent:state.data.tokenPresent}; }"})
        (project/'artifacts/live-download-start.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    if '--download-status' in sys.argv:
        result=call(9,'evaluate_script',{'pageId':page_id,'waitForStableDom':False,'function':"async () => { const until=Date.now()+20000; let s,j; do { s=await chrome.runtime.sendMessage({type:'GET_STATE'}); j=s.data.jobs.filter(j=>j.title==='Проверка VOLNA').at(-1); if(!j || ['complete','partial','failed','cancelled'].includes(j.status)) break; await new Promise(r=>setTimeout(r,500)); } while(Date.now()<until); if(!j)return {job:false}; const id=j.items[0]?.downloadId; const d=id?(await chrome.downloads.search({id}))[0]:null; return {status:j.status,error:j.error,items:j.items.map(i=>({status:i.status,error:i.error,notice:i.notice,bytes:i.bytes,filename:i.filename})),download:d?{state:d.state,exists:d.exists,bytesReceived:d.bytesReceived,totalBytes:d.totalBytes,filename:d.filename}:null,tokenPresent:s.data.tokenPresent}; }"})
        (project/'artifacts/live-download-status.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    (project/'artifacts/installed-extension.json').write_text(json.dumps({'id':extension_id,'version':'1.0.0','verifiedBy':'Chrome DevTools MCP install_extension + list_extensions + popup state'},ensure_ascii=False,indent=2),encoding='utf-8')
finally:
    proc.stdin.close()
    try:proc.wait(timeout=3)
    except subprocess.TimeoutExpired:proc.terminate()



