#!/usr/bin/env python3
"""Tiny dependency-free bundler: turns the ES modules under src/ into one classic script
(module registry + require) and writes a single self-contained HTML page.

usage: python3 scripts/bundle.py <out.html> [--fragment]
  --fragment  omit <!doctype>/<html>/<head>/<body> (for hosts that add their own skeleton)
"""
import os, re, sys, json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ENTRY = 'src/app/main.js'
mods, order = {}, []

IMPORT_RE = re.compile(r"import\s+(\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'([^']+)';", re.S)
DYN_RE = re.compile(r"import\('([^']+)'\)")

def resolve(base, spec):
    return os.path.normpath(os.path.join(os.path.dirname(base), spec)).replace(os.sep, '/')

def load(path):
    if path in mods: return
    src = open(os.path.join(ROOT, path), encoding='utf-8').read()
    deps = [resolve(path, m.group(2)) for m in IMPORT_RE.finditer(src)] + [resolve(path, m.group(1)) for m in DYN_RE.finditer(src)]
    mods[path] = None
    for d in deps: load(d)
    exports = []
    def imp(m):
        what, spec = m.group(1), resolve(path, m.group(2))
        if what.startswith('*'):
            return f"const {what.split()[-1]} = __r({json.dumps(spec)});"
        names = [n.strip() for n in what.strip('{} \n').split(',') if n.strip()]
        names = [n.replace(' as ', ': ') for n in names]
        return "const { " + ", ".join(names) + " } = __r(" + json.dumps(spec) + ");"
    src = IMPORT_RE.sub(imp, src)
    src = DYN_RE.sub(lambda m: f"Promise.resolve(__r({json.dumps(resolve(path, m.group(1)))}))", src)
    def decl(m):
        exports.append(m.group(2))
        return m.group(1)
    src = re.sub(r"^export\s+((?:async\s+)?function\s*\*?\s*(\w+))", decl, src, flags=re.M)
    src = re.sub(r"^export\s+((?:const|let|class)\s+(\w+))", decl, src, flags=re.M)
    def lst(m):
        for n in m.group(1).split(','):
            n = n.strip()
            if not n: continue
            a, _, b = n.partition(' as ')
            exports.append(f"{(b or a).strip()}: {a.strip()}" if b else a.strip())
        return ''
    src = re.sub(r"^export\s*\{([^}]*)\};?", lst, src, flags=re.M)
    assert not re.search(r'^\s*export\b', src, re.M), f'unhandled export in {path}'
    body = src + "\nObject.assign(__e, { " + ", ".join(exports) + " });"
    mods[path] = body
    order.append(path)

load(ENTRY)
js = ["(function(){'use strict';", "const __defs = {}, __cache = {};",
      "function __r(p){ if (__cache[p]) return __cache[p]; const e = __cache[p] = {}; __defs[p](e); return e; }"]
for p in order:
    js.append(f"__defs[{json.dumps(p)}] = function(__e){{\n{mods[p]}\n}};")
js.append(f"__r({json.dumps(ENTRY)});\n}})();")
script = "\n".join(js).replace('</script', '<\\/script')

css = open(os.path.join(ROOT, 'styles.css'), encoding='utf-8').read()
html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
body = re.search(r'<body>(.*?)<script', html, re.S).group(1).strip()
frag = '--fragment' in sys.argv
head = ('<title>Tendies Studio</title>\n' if frag else '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n<title>Tendies Studio</title>\n')
extra_css = '\n/* single-file build */\nhtml, body { height: 100%; }\n#app { height: 100%; }\n'
out = head + f"<style>\n{css}{extra_css}</style>\n" + ('' if frag else '</head>\n<body>\n') + body + f"\n<script>\n{script}\n</script>\n" + ('' if frag else '</body>\n</html>\n')
open(sys.argv[1], 'w', encoding='utf-8').write(out)
print('wrote', sys.argv[1], len(out) // 1024, 'KB,', len(order), 'modules')
