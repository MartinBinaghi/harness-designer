window.__click = (text) => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text); if(!b) return 'missing '+text; b.click(); return 'ok '+text; };
