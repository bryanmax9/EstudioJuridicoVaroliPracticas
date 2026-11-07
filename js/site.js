/* Varoli - Slovsa · funciones comunes: buscador, contadores y banner rotativo */
(function(){
var IDX=[{"t": "Inicio", "u": "index.html", "k": "portada estudio jurídico lima varoli slovsa abogados", "c": "Página"}, {"t": "El estudio", "u": "estudio.html", "k": "nosotros quiénes somos misión visión principios valores trayectoria equipo proceso de consulta", "c": "Página"}, {"t": "Áreas de práctica", "u": "servicios.html", "k": "servicios áreas derecho", "c": "Página"}, {"t": "Noticias y actualidad jurídica", "u": "noticias.html", "k": "noticias artículos ley 32069 sunafil novedades", "c": "Página"}, {"t": "Contacto y primera consulta gratuita", "u": "contacto.html", "k": "contacto consulta gratuita whatsapp teléfono correo dirección lince horario formulario", "c": "Página"}, {"t": "Sistema Interno", "u": "panel/", "k": "intranet acceso equipo sistema interno expedientes plazos", "c": "Página"}, {"t": "Brochure institucional (PDF)", "u": "docs/brochure-varoli-slovsa.pdf", "k": "brochure folleto presentación descargar", "c": "Descarga"}, {"t": "Checklist SUNAFIL (PDF)", "u": "docs/checklist-sunafil.pdf", "k": "inspección laboral guía descargar", "c": "Descarga"}, {"t": "Guía de contratos comerciales (PDF)", "u": "docs/guia-contratos-comerciales.pdf", "k": "cláusulas contratos guía descargar", "c": "Descarga"}, {"t": "Modelo de carta notarial (PDF)", "u": "docs/modelo-carta-notarial.pdf", "k": "requerimiento obligación formato descargar", "c": "Descarga"}, {"t": "Política de privacidad", "u": "privacidad.html", "k": "datos personales ley 29733 derechos arco", "c": "Legal"}, {"t": "Contrataciones con el Estado", "u": "area-contrataciones.html", "k": "Del proceso de selección a la ejecución del contrato Ley N.° 32069 y su reglamento Procesos de selección Impugnaciones Procedimientos sancionadores Ejecución contractual Controversias Amparos y vías judiciales Participas o planeas participar en procesos de selección Te notificaron el inicio de un procedimiento sancionador Te aplicaron una penalidad que consideras indebida La entidad resolvió tu contrato Procesos de selección Impugnaciones Sancionadores Arbitraje", "c": "Área de práctica"}, {"t": "Derecho Administrativo", "u": "area-administrativo.html", "k": "Cada plazo cuenta: actuar a tiempo lo cambia todo TUO de la Ley N.° 27444 Procedimientos sancionadores Recursos administrativos Fiscalizaciones e inspecciones Trámites ante entidades Nulidad y silencio administrativo Vía contencioso-administrativa Recibiste una carta de imputación o una resolución desfavorable Una entidad programó una inspección en tu empresa Necesitas una autorización que no se resuelve Sanciones Recursos Licencias Fiscalizaciones", "c": "Área de práctica"}, {"t": "Derecho Comercial", "u": "area-comercial.html", "k": "Contratos que protegen el negocio Revisar antes de firmar cuesta menos que litigar después Contratos mercantiles Garantías y financiamiento Cobranza y recuperación Incumplimientos Arbitraje y conciliación Marcas y transferencia vehicular Vas a cerrar un acuerdo importante Un cliente o proveedor no cumple Necesitas recuperar una deuda Quieres proteger tu marca antes de lanzarla Contratos Cobranza Marcas Arbitraje", "c": "Área de práctica"}, {"t": "Derecho Societario", "u": "area-societario.html", "k": "Una estructura sólida desde el primer día Ley General de Sociedades, Ley N.° 26887 Constitución de empresas Cambios societarios Gobierno corporativo Convenios entre socios Reorganización Inicio de operaciones Vas a constituir una empresa Incorporarás un socio o inversionista Debes actualizar poderes o estatutos Existen desacuerdos sobre las decisiones de la sociedad Constitución Estatutos Poderes Reorganización", "c": "Área de práctica"}, {"t": "Derecho Inmobiliario", "u": "area-inmobiliario.html", "k": "Seguridad jurídica en cada inmueble Verificar antes de firmar evita problemas difíciles de corregir Estudio de títulos Compraventa de inmuebles Arrendamientos Saneamiento físico-legal Garantías inmobiliarias Propiedad horizontal Vas a comprar, vender o alquilar un inmueble Encontraste inconsistencias en la partida registral Necesitas ordenar la documentación de una propiedad antes de una operación Estudio de títulos Compraventa Arrendamientos Saneamiento", "c": "Área de práctica"}, {"t": "Derecho Laboral", "u": "area-laboral.html", "k": "Prevención antes que contingencia Normativa laboral del régimen de la actividad privada Contratos y políticas Inspecciones de SUNAFIL Compliance laboral Despidos y procedimientos disciplinarios Beneficios sociales Procesos judiciales laborales Recibiste una notificación de SUNAFIL Evalúas despedir a un trabajador Fuiste demandado por un excolaborador Quieres auditar el cumplimiento laboral de tu empresa SUNAFIL Despidos Compliance Beneficios", "c": "Área de práctica"}];
var norm=function(s){return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');};
var css=document.createElement('style');
css.textContent=`
.sx-btn{background:none;border:1px solid rgba(196,154,108,.35);color:#C49A6C;width:36px;height:36px;border-radius:2px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;margin-left:16px;flex-shrink:0;transition:background .2s}
.sx-btn:hover{background:rgba(196,154,108,.12)}
.sx-btn svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.6}
.sx-ov{position:fixed;inset:0;z-index:2000;background:rgba(7,22,48,.96);backdrop-filter:blur(8px);display:none;padding:12vh 24px 24px;overflow:auto}
.sx-ov.open{display:block}
.sx-box{max-width:720px;margin:0 auto}
.sx-in{width:100%;background:transparent;border:0;border-bottom:1px solid #C49A6C;color:#f0ece4;font:300 clamp(24px,4vw,38px) 'Cormorant Garamond',Georgia,serif;padding:12px 0;outline:none}
.sx-hint{font:11px 'DM Sans',sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:#9a9288;margin:14px 0 24px}
.sx-res a{display:flex;justify-content:space-between;gap:16px;align-items:baseline;padding:16px 4px;border-bottom:1px solid rgba(196,154,108,.15);color:#f0ece4;font:400 20px 'Cormorant Garamond',Georgia,serif;transition:padding .2s,color .2s}
.sx-res a:hover,.sx-res a:focus{padding-left:14px;color:#C49A6C;outline:none}
.sx-res small{font:10px 'DM Sans',sans-serif;letter-spacing:2px;text-transform:uppercase;color:#9a9288;white-space:nowrap}
.sx-x{position:absolute;top:22px;right:28px;background:none;border:0;color:#9a9288;font-size:34px;cursor:pointer}
.hero-feats{position:absolute;right:clamp(24px,5vw,80px);bottom:170px;z-index:4;width:340px;height:230px}
.hero-feats .hero-feature{position:absolute;left:0;right:0;bottom:46px;max-width:none;opacity:0!important;transform:translateY(14px);transition:opacity .7s,transform .7s;animation:none!important;pointer-events:none}
.hero-feats .hero-feature.on{opacity:1!important;transform:none;pointer-events:auto}
.hero-dots{position:absolute;left:0;bottom:0;display:flex;gap:8px;align-items:center}
.hero-dots button{width:22px;height:3px;border:0;padding:0;background:rgba(196,154,108,.3);cursor:pointer;transition:background .3s,width .3s}
.hero-dots button.on{background:#C49A6C;width:38px}
.hero-dots .pp{width:auto;height:auto;background:none;color:#C49A6C;font:10px 'DM Sans',sans-serif;letter-spacing:1.5px;text-transform:uppercase;margin-left:10px}
@media(max-width:900px){.hero-feats{display:none}.sx-btn.d{display:none}}
@media(min-width:901px){.sx-btn.m{display:none}}
.sx-btn.d{margin-left:8px}.sx-btn.m{margin-left:auto;margin-right:14px}
`;
document.head.appendChild(css);

/* ---- buscador ---- */
var ov=document.createElement('div');ov.className='sx-ov';ov.setAttribute('role','dialog');ov.setAttribute('aria-label','Buscar en el sitio');
ov.innerHTML='<button class="sx-x" aria-label="Cerrar">×</button><div class="sx-box"><input class="sx-in" type="search" placeholder="Buscar: SUNAFIL, contratos, brochure…" aria-label="Buscar"><div class="sx-hint">Escribe para buscar · Esc para cerrar</div><div class="sx-res"></div></div>';
document.body.appendChild(ov);
var inp=ov.querySelector('.sx-in'),res=ov.querySelector('.sx-res');
function render(q){
  var toks=norm(q).split(/\s+/).filter(Boolean);var out=IDX;
  if(toks.length){out=IDX.filter(function(it){var h=norm(it.t+' '+it.k);return toks.every(function(t){return h.indexOf(t)>-1;});});}
  res.innerHTML=out.length?out.slice(0,10).map(function(it){return '<a href="'+it.u+'"><span>'+it.t+'</span><small>'+it.c+'</small></a>';}).join(''):'<p style="color:#9a9288;font:300 15px DM Sans,sans-serif;padding:12px 4px">Sin resultados. Escríbenos por WhatsApp y te orientamos.</p>';
}
function open(){ov.classList.add('open');document.body.style.overflow='hidden';render('');setTimeout(function(){inp.focus();},50);}
function close(){ov.classList.remove('open');document.body.style.overflow='';}
inp.addEventListener('input',function(){render(inp.value);});
ov.querySelector('.sx-x').addEventListener('click',close);
ov.addEventListener('click',function(e){if(e.target===ov)close();});
document.addEventListener('keydown',function(e){if(e.key==='Escape')close();if(e.key==='/'&&!/input|textarea|select/i.test((document.activeElement||{}).tagName||'')){e.preventDefault();open();}});
var nav=document.getElementById('mainNav');
function mk(cls){var b=document.createElement('button');b.className='sx-btn '+cls;b.setAttribute('aria-label','Buscar en el sitio');b.innerHTML='<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';b.addEventListener('click',open);return b;}
if(nav){var links=nav.querySelector('.nav-links'),mb=nav.querySelector('.nav-mobile-btn');
 if(links)links.appendChild(mk('d'));
 var m=mk('m');if(mb)nav.insertBefore(m,mb);else nav.appendChild(m);}

/* ---- contadores ---- */
var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
var cio=new IntersectionObserver(function(es){es.forEach(function(en){if(!en.isIntersecting)return;cio.unobserve(en.target);var el=en.target,m=/^(\D*)(\d+)(\D*)$/.exec(el.textContent.trim());if(!m||reduce)return;var to=+m[2],t0=null;function st(ts){if(!t0)t0=ts;var p=Math.min((ts-t0)/1200,1),v=Math.round(to*(1-Math.pow(1-p,3)));el.textContent=m[1]+v+m[3];if(p<1)requestAnimationFrame(st);}requestAnimationFrame(st);});},{threshold:.6});
document.querySelectorAll('.stat-num,.stats-num,.h-badge-num').forEach(function(el){cio.observe(el);});

/* ---- banner rotativo de la portada ---- */
var box=document.querySelector('.hero-feats');
if(box){var items=[].slice.call(box.querySelectorAll('.hero-feature')),dots=document.createElement('div'),cur=0,timer=null,paused=reduce;dots.className='hero-dots';
 items.forEach(function(_,i){var d=document.createElement('button');d.setAttribute('aria-label','Mensaje '+(i+1));d.addEventListener('click',function(){go(i);});dots.appendChild(d);});
 var pp=document.createElement('button');pp.className='pp';pp.textContent=paused?'Reanudar':'Pausar';pp.addEventListener('click',function(){paused=!paused;pp.textContent=paused?'Reanudar':'Pausar';});dots.appendChild(pp);box.appendChild(dots);
 function go(i){cur=(i+items.length)%items.length;items.forEach(function(it,j){it.classList.toggle('on',j===cur);});[].slice.call(dots.querySelectorAll('button:not(.pp)')).forEach(function(d,j){d.classList.toggle('on',j===cur);});}
 go(0);setInterval(function(){if(!paused)go(cur+1);},6500);}
})();
