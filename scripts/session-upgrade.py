from pathlib import Path
p=Path('src/provider.ts');s=p.read_text(encoding='utf-8')
start=s.index('export async function hydrateTracks');end=s.index('export interface DownloadOption')
part=s[start:end]
part=part.replace('token: string,\n','token: string,\n  request=api,\n')
part=part.replace('await api(', 'await request(').replace('hydrateTracks(rows, token)','hydrateTracks(rows, token,request)').replace('if (!token)','if (!token && request===api)')
part=part.replace(r'([\da-f-]{20,})',r'((?:lk\.)?[\da-f-]{20,})')
s=s[:start]+part+s[end:];p.write_text(s,encoding='utf-8')
