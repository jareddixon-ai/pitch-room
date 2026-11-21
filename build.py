import pathlib
src = pathlib.Path(__file__).parent / 'src'
html = (src / 'app.html').read_text()
html = html.replace('<!--DELIVERY-->', (src / 'delivery.js').read_text())
html = html.replace('<!--QUESTIONS-->', (src / 'questions.js').read_text())
assert '</script' not in (src / 'delivery.js').read_text() + (src / 'questions.js').read_text()
out = pathlib.Path(__file__).parent / 'index.html'
out.write_text(html)
print(out, len(html), 'bytes')
