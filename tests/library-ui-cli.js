async page => {
  await page.context().addInitScript(()=>{
    const settings={theme:"dark",format:"original",quality:"best",concurrency:2,zip:true,numbering:true,covers:true,metadata:true,folder:"VOLNA",coverSize:400,logLevel:"off",lyricsTags:false,lyricsFile:false,unicodeFilenames:false,structuredFolders:true};
    window.chrome=window.chrome||{};
    window.chrome.runtime={id:"volna-fsa-test",sendMessage:async m=>{
      if(m.type==="GET_STATE")return {ok:true,data:{settings,jobs:[],tokenPresent:false}};
      if(m.type==="PAGE")return {ok:true,data:null};
      if(m.type==="SORT_LIBRARY"){const library=await import("/src/library.ts");return {ok:true,data:await library.compactLibrary()};}
      return {ok:true};
    }};
    window.chrome.storage={onChanged:{addListener(){},removeListener(){}}};
  });
  await page.goto("http://127.0.0.1:5174/popup.html?view=settings&folder=connect");
  const initial=await page.evaluate(async()=>{
    const root=await navigator.storage.getDirectory();
    const testName="volna-library-test-"+crypto.randomUUID();
    const parent=await root.getDirectoryHandle(testName,{create:true});
    const directory=await parent.getDirectoryHandle("Треки",{create:true});
    const file=await directory.getFileHandle("07 · Old.mp3",{create:true});
    const writer=await file.createWritable();await writer.write(new Blob(["old-audio-fixture"]));await writer.close();
    window.__folderTest={root,testName,directory};
    window.showDirectoryPicker=async()=>directory;
    return {nativeHandle:directory.constructor.name,permission:await directory.queryPermission({mode:"readwrite"})};
  });
  if(initial.permission!=="granted")throw Error("OPFS test permission unavailable");
  await page.getByRole("button",{name:"Выбрать папку «Треки»",exact:true}).click();
  await page.getByText("Подключено · сортировка включена",{exact:true}).waitFor();
  const sorted=await page.evaluate(async()=>{
    const d=window.__folderTest.directory;
    const names=[];for await(const f of d.values())names.push(f.name);
    return {names,content:await(await(await d.getFileHandle("01 · Old.mp3")).getFile()).text()};
  });
  if(sorted.names.join()!=="01 · Old.mp3"||sorted.content!=="old-audio-fixture")throw Error("07 did not become 01 byte-for-byte");
  const saved=await page.evaluate(async()=>{
    const module=await import("/src/library.ts");
    const result=await module.saveSortedTrack(new Blob(["new-audio-fixture"]),"88 · New.mp3");
    return result;
  });
  if(saved.name!=="02 · New.mp3")throw Error("New song did not use the folder count");
  await page.reload();
  await page.getByText("Подключено · сортировка включена",{exact:true}).waitFor();
  const persisted=await page.evaluate(async()=>{
    const module=await import("/src/library.ts");
    const status=await module.libraryStatus();
    const pair=await Promise.all([module.saveSortedTrack(new Blob(["third"]),"99 · Third.mp3"),module.saveSortedTrack(new Blob(["fourth"]),"99 · Fourth.mp3")]);
    return {status,numbers:pair.map(r=>r.number).sort()};
  });
  if(persisted.numbers.join()!=="3,4")throw Error("Web Locks did not serialize folder writes");
  await page.screenshot({path:"artifacts/library-sorting-test.png",fullPage:true});
  // The fixture uses genuine browser OPFS handles, not the user's Downloads.
  await page.evaluate(async()=>{const module=await import("/src/library.ts");await module.disconnectLibrary();});
  return {passed:5,checks:["Native browser directory handle and real IndexedDB","07 becomes 01 without changing file bytes","New song is 02 from actual folder count","Directory handle survives reload","Parallel calls serialize as 03 and 04"],initial,persisted};
}
