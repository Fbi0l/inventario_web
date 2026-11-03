// Seguranca do site (1.5.5), sem rede: integridade (SRI) dos scripts externos, politica CSP
// e neutralizacao de formulas na exportacao CSV.
const fs=require('fs'),crypto=require('crypto'),assert=require('node:assert/strict');
const sri=file=>'sha384-'+crypto.createHash('sha384').update(fs.readFileSync(file)).digest('base64');

for(const dir of ['.','SITE_PUBLICAR']){
 const html=fs.readFileSync(`${dir}/index.html`,'utf8');
 // Todo script externo tem integridade sha384 e crossorigin.
 const externos=[...html.matchAll(/<script\s[^>]*src="(https?:[^"]+)"[^>]*>/g)];
 assert.ok(externos.length>=5,`${dir}: scripts externos encontrados`);
 for(const [tag,src] of externos){
  assert.match(tag,/integrity="sha384-[A-Za-z0-9+/=]{64}"/,`${dir}: sem integridade em ${src}`);
  assert.match(tag,/crossorigin="anonymous"/,`${dir}: sem crossorigin em ${src}`);
  assert.match(src,/@\d+\.\d+\.\d+\//,`${dir}: versao exata em ${src}`);
 }
 // Nenhum script inline nem atributo on* (a politica nao permite).
 assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(html),`${dir}: script inline`);
 assert.ok(!/\son[a-z]+="/i.test(html),`${dir}: atributo on* inline`);
 // Politica CSP: so o proprio site e os CDNs conhecidos podem fornecer scripts.
 const csp=(html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)||[])[1];
 assert.ok(csp,`${dir}: politica CSP ausente`);
 const scriptSrc=(csp.match(/script-src ([^;]+)/)||[])[1]||'';
 assert.deepEqual(scriptSrc.trim().split(/\s+/).sort(),["'self'",'https://cdn.jsdelivr.net','https://cdn.sheetjs.com'].sort());
 assert.match(csp,/object-src 'none'/);assert.match(csp,/base-uri 'self'/);
 // As bibliotecas que tambem estao no node_modules batem com a integridade declarada.
 const local={'pdf-lib@1.17.1/dist/pdf-lib.min.js':'node_modules/pdf-lib/dist/pdf-lib.min.js',
  '@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js':'node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js',
  'qrcodejs@1.0.0/qrcode.min.js':'node_modules/qrcodejs/qrcode.min.js'};
 for(const [trecho,arquivo] of Object.entries(local)){
  const tag=externos.find(([,src])=>src.includes(trecho));assert.ok(tag,`${dir}: ${trecho}`);
  assert.ok(tag[0].includes(`integrity="${sri(arquivo)}"`),`${dir}: integridade de ${trecho} nao confere`);
 }
 // SheetJS carregada sob demanda, tambem com integridade (mesmo arquivo do pacote de testes).
 const imp=fs.readFileSync(`${dir}/importar-planilha.js`,'utf8');
 assert.ok(imp.includes(`script.integrity='${sri('node_modules/xlsx/dist/xlsx.full.min.js')}'`),`${dir}: integridade da SheetJS`);
 assert.ok(imp.includes("script.crossOrigin='anonymous'"));
}

// CSV: texto que vira formula no Excel e neutralizado; numeros continuam numeros.
const app=fs.readFileSync('app.js','utf8');
const csvCell=new Function(app.match(/const csvCell=[^\n]+/)[0]+';return csvCell;')();
for(const perigoso of ['=HYPERLINK("http://x","clique")','+1+1','-2+3','@SUM(A1)','\t=1','\r=1'])
 assert.ok(csvCell(perigoso).startsWith(`"'`),`neutraliza ${JSON.stringify(perigoso)}`);
assert.equal(csvCell('Notebook'),'"Notebook"');assert.equal(csvCell('a=b'),'"a=b"');
assert.equal(csvCell(-5),'"-5"');assert.equal(csvCell(null),'""');assert.equal(csvCell('aspas "x"'),'"aspas ""x"""');
assert.ok(/r\.map\(csvCell\)/.test(app),'csvDownload usa csvCell');

// App instalavel (1.6.0): manifesto e icones validos nas duas copias; o service worker nunca guarda dados do Supabase.
for(const dir of ['.','SITE_PUBLICAR']){
 const html=fs.readFileSync(`${dir}/index.html`,'utf8');
 assert.match(html,/<link rel="manifest" href="manifest.webmanifest">/,`${dir}: manifesto ligado`);
 assert.match(html,/<script src="instalar\.js\?v=[\d.]+"><\/script>/,`${dir}: instalar.js carregado`);
 const m=JSON.parse(fs.readFileSync(`${dir}/manifest.webmanifest`,'utf8'));
 assert.equal(m.display,'standalone');assert.equal(m.scope,'./');assert.equal(m.start_url,'./');
 for(const i of m.icons)assert.ok(fs.existsSync(`${dir}/${i.src}`),`${dir}: icone ${i.src}`);
 assert.ok(m.icons.some(i=>i.sizes==='192x192')&&m.icons.some(i=>i.sizes==='512x512')&&m.icons.some(i=>i.purpose==='maskable'));
 assert.ok(fs.existsSync(`${dir}/assets/apple-touch-icon.png`));
 const sw=fs.readFileSync(`${dir}/sw.js`,'utf8');
 assert.ok(!/supabase\.co/.test(sw),`${dir}: service worker nao menciona o Supabase`);
 assert.match(sw,/const PERMITIDOS = \[self\.location\.origin, 'https:\/\/cdn\.jsdelivr\.net', 'https:\/\/cdn\.sheetjs\.com'\];/);
 assert.match(sw,/req\.method !== 'GET' \|\| !PERMITIDOS\.includes\(url\.origin\)\) return;/,`${dir}: so GET do proprio site e dos CDNs`);
 assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(fs.readFileSync(`${dir}/instalar.js`,'utf8')),`${dir}: instalar.js sem HTML a partir de texto`);
}
for(const f of ['index.html','styles.css','instalar.js','sw.js','manifest.webmanifest'])assert.equal(fs.readFileSync(f,'utf8'),fs.readFileSync(`SITE_PUBLICAR/${f}`,'utf8'),`SITE_PUBLICAR/${f} igual ao da raiz`);
console.log('Site aprovado: integridade (SRI) em todos os scripts externos, politica CSP restrita, CSV sem formulas e app instalavel seguro.');
