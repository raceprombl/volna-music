"""Build the requested Graphify source graph without sending code to an LLM."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

project = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(project / '.tools' / 'graphify'))
from graphify.detect import detect, save_manifest
from graphify.extract import extract
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all, label_communities_by_hub
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json
from graphify.exporters.html import to_html
from graphify.diagnostics import diagnose_extraction, format_diagnostic_report

root = project / 'src'
out = project / 'graphify-out'
out.mkdir(exist_ok=True)
(out / '.graphify_python').write_text(sys.executable, encoding='utf-8')
(out / '.graphify_root').write_text(str(root), encoding='utf-8')
detection = detect(root)
(out / '.graphify_detect.json').write_text(json.dumps(detection, ensure_ascii=False), encoding='utf-8')
print(f"Corpus: {detection['total_files']} files; ~{detection.get('total_words',0)} words")
for cat, files in detection['files'].items():
    if files: print(f'  {cat}: {len(files)}')
if detection.get('skipped_sensitive'):
    print('Skipped sensitive:', detection['skipped_sensitive'])
if detection['total_files'] > 500 or detection.get('total_words', 0) > 2000000:
    raise SystemExit('Corpus too large; narrow the source directory first')
if any(detection['files'].get(cat) for cat in ('document', 'paper', 'image', 'video')):
    raise SystemExit('Unexpected non-code input: semantic extraction is required')
code = [Path(f) for f in detection['files'].get('code', [])]
result = extract(code, cache_root=project)
semantic = {'nodes': [], 'edges': [], 'hyperedges': [], 'input_tokens': 0, 'output_tokens': 0}
for name, value in [('ast',result),('semantic',semantic),('extract',result)]:
    (out / f'.graphify_{name}.json').write_text(json.dumps(value, ensure_ascii=False),encoding='utf-8')
graph = build_from_json(result, root=str(root), directed=False)
if not graph.number_of_nodes(): raise SystemExit('Graph is empty')
communities = cluster(graph)
cohesion = score_all(graph, communities)
gods = god_nodes(graph)
surprises = surprising_connections(graph, communities)
labels = label_communities_by_hub(graph, communities)
names = {'main.tsx':'Popup interface','content.ts':'Page integration','offscreen.ts':'Download engine','engine-item.ts':'Download engine','background.ts':'Chrome background','background-handlers.ts':'Chrome background','provider.ts':'Yandex API','shared.ts':'Shared helpers & API','types.ts':'Shared data model','stream-zip.ts':'ZIP64 writer','archive-store.ts':'Temporary archives'}
names.update({'library.ts':'Track library','StreamZip':'Streaming ZIP64'})
names.update({'ProgressBatch':'Transfer progress','progress-batch.ts':'Transfer progress','media-fetch.ts':'Media transfers'})
labels = {key:names.get(value,value) for key,value in labels.items()}
questions = suggest_questions(graph, communities, labels)
if not to_json(graph, communities, str(out/'graph.json'), community_labels=labels):
    raise SystemExit('Graph shrink guard refused export')
report = generate(graph,communities,cohesion,labels,gods,surprises,detection,{'input':0,'output':0},str(root),suggested_questions=questions)
(out/'GRAPH_REPORT.md').write_text(report,encoding='utf-8')
(out/'.graphify_labels.json').write_text(json.dumps(labels,ensure_ascii=False),encoding='utf-8')
analysis={'communities':communities,'cohesion':cohesion,'gods':gods,'surprises':surprises,'questions':questions}
(out/'.graphify_analysis.json').write_text(json.dumps(analysis,ensure_ascii=False,default=list),encoding='utf-8')
diagnostics=diagnose_extraction(result,directed=False,root=str(root))
print(format_diagnostic_report(diagnostics))
(out/'HEALTH.txt').write_text(format_diagnostic_report(diagnostics),encoding='utf-8')
warnings = [f"{name}: {diagnostics.get(name,0)}" for name in ('dangling_endpoint_edges','self_loop_edges','undirected_same_endpoint_collapsed_edges') if diagnostics.get(name,0)]
if warnings:
    with (out/'GRAPH_REPORT.md').open('a',encoding='utf-8') as report_file:
        report_file.write('\n\n## Graph health warning\n\n'+ '; '.join(warnings) + '.\nSome parser edges have unresolved endpoints or share the same node pair. The simple undirected graph collapses such parallel relations. Treat it as navigation; verify exact calls in source. See HEALTH.txt for diagnostics.\n')
to_html(graph,communities,str(out/'graph.html'),community_labels=labels)
save_manifest(detection['files'],root=str(project),scan_corpus={f for files in detection['files'].values() for f in files})
cost=json.loads((out/'cost.json').read_text(encoding='utf-8')) if (out/'cost.json').exists() else {'runs':[],'total_input_tokens':0,'total_output_tokens':0}
cost['runs'].append({'date':datetime.now(timezone.utc).isoformat(),'input_tokens':0,'output_tokens':0,'files':len(code)})
(out/'cost.json').write_text(json.dumps(cost,indent=2),encoding='utf-8')
print(f'Graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges, {len(communities)} communities')
print('Extraction token cost: 0 input, 0 output (AST only)')
print(json.dumps({'labels':labels,'gods':gods[:3],'surprises':surprises[:2],'questions':questions[:2]},ensure_ascii=False,default=list))
