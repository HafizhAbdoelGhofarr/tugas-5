
const fs = require('fs');

let css = fs.readFileSync('css/style.css', 'utf8');
let cssGood = css.substring(0, css.indexOf('} \r\n\r\n@media (max-width: 820px)') || css.indexOf('@media (max-width: 820px)'));
// Actually, line 967 was before the bad characters in css
cssGood = css.substring(0, css.indexOf('/* Accordion') !== -1 ? css.indexOf('/* Accordion') : css.length);
// wait, the bad chars are / * A c c o r d i o n so indexOf('/* Accordion') won't work.
cssGood = css.replace(/\0/g, ''); // strip null bytes
fs.writeFileSync('css/style.css', cssGood);

let js = fs.readFileSync('js/app.js', 'utf8');
js = js.replace(/\0/g, '');
fs.writeFileSync('js/app.js', js);

