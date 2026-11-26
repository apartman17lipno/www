(function(){
  var PROD_ENDPOINT='https://script.google.com/macros/s/AKfycbxqNQdGvT4scxO_k0uNsjusx61ivbBodvtGSQCqQwsHtzOn6fPTu6IHN-PEZ7Qisspr9A/exec';
  var TEST_ENDPOINT='https://script.google.com/macros/s/AKfycbyZViBGlJQ0I8rDSNPGJMOhPOv0Go2KEEsoSoqvS6wH9HP4es48nBq288caje392S2fYA/exec';
  var isProd=window.location.hostname==='apartman17lipno.cz'||window.location.hostname==='www.apartman17lipno.cz';
  var ENDPOINT=isProd?PROD_ENDPOINT:TEST_ENDPOINT;
  // Komunikace se skriptem přes element script (obchází omezení CORS u Google Apps Script)
  function jsonp(params){
    return new Promise(function(resolve,reject){
      var cb='cb'+Date.now()+Math.floor(Math.random()*1e6), sc=document.createElement('script'), done=false, timer;
      function cleanup(){done=true;clearTimeout(timer);delete window[cb];if(sc.parentNode)sc.parentNode.removeChild(sc);}
      window[cb]=function(j){if(done)return;cleanup();resolve(j);};
      sc.onerror=function(){if(done)return;cleanup();reject(new Error('net'));};
      timer=setTimeout(function(){if(done)return;cleanup();reject(new Error('timeout'));},20000);
      var q=Object.keys(params).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);}).join('&');
      sc.src=ENDPOINT+'?'+q+'&callback='+cb;
      document.head.appendChild(sc);
    });
  }
  var fromEl=document.getElementById('f-from'), toEl=document.getElementById('f-to');
  var calEl=document.getElementById('cal');
  var busy={}, status='', selFrom='', selTo='', limit='9999-12-31';
  function p2(n){return n<10?'0'+n:''+n;}
  function iso(d){return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());}
  function parse(s){var a=s.split('-');return new Date(+a[0],+a[1]-1,+a[2]);}
  function addDays(s,n){var d=parse(s);d.setDate(d.getDate()+n);return iso(d);}
  function nightsBetween(a,b){return Math.round((parse(b)-parse(a))/86400000);}
  function fmt(s){var d=parse(s);return d.getDate()+'. '+(d.getMonth()+1)+'. '+d.getFullYear();}
  var today=iso(new Date());
  var view=new Date(); view.setDate(1);
  var minView=new Date(view.getTime());
  function limitFor(a){var d=addDays(a,1),i;for(i=0;i<400;i++){if(busy[d])return d;d=addDays(d,1);}return '9999-12-31';}
  function state(ds){
    if(ds<today) return 'off';
    if(selFrom&&!selTo){
      if(ds===selFrom) return 'sel';
      if(ds>selFrom) return ds<=limit?'ok':(busy[ds]?'busy':'off');
      return busy[ds]?'busy':'ok';
    }
    if(ds===selFrom||ds===selTo) return 'sel';
    if(selFrom&&selTo&&ds>selFrom&&ds<selTo) return 'rng';
    return busy[ds]?'busy':'ok';
  }
  function monthHtml(y,m,cls){
    var first=(new Date(y,m,1).getDay()+6)%7, days=new Date(y,m+1,0).getDate(), i, d, h='';
    h+='<div class="cal-m '+cls+'"><h4>'+new Date(y,m,1).toLocaleDateString('cs-CZ',{month:'long',year:'numeric'})+'</h4><div class="cal-g">';
    ['Po','Út','St','Čt','Pá','So','Ne'].forEach(function(n){h+='<span>'+n+'</span>';});
    for(i=0;i<first;i++) h+='<i></i>';
    for(d=1;d<=days;d++){
      var ds=y+'-'+p2(m+1)+'-'+p2(d), st=state(ds);
      var c='cal-d'+(st==='busy'?' busy':'')+(st==='sel'?' sel':'')+(st==='rng'?' rng':'');
      h+='<button type="button" class="'+c+'" data-d="'+ds+'"'+((st==='off'||st==='busy')?' disabled':'')+' aria-label="'+d+'. '+(m+1)+'. '+y+(st==='busy'?', obsazeno':'')+'">'+d+'</button>';
    }
    return h+'</div></div>';
  }
  function summary(){
    if(status) return status;
    if(selFrom&&selTo){var n=nightsBetween(selFrom,selTo);return 'Příjezd '+fmt(selFrom)+' · Odjezd '+fmt(selTo)+' ('+n+' '+(n===1?'noc':(n<5?'noci':'nocí'))+')';}
    if(selFrom) return 'Příjezd: '+fmt(selFrom)+'. Nyní vyberte odjezd.';
    return 'Vyberte v kalendáři příjezd a odjezd.';
  }
  function render(){
    var y=view.getFullYear(), m=view.getMonth(), next=new Date(y,m+1,1);
    calEl.innerHTML='<div class="cal-top"><button type="button" class="cal-nav" data-nav="-1" aria-label="Předchozí měsíc"'+(view<=minView?' disabled':'')+'>‹</button><span class="cal-title">Termín pobytu</span><button type="button" class="cal-nav" data-nav="1" aria-label="Další měsíc">›</button></div>'+
      '<div class="cal-months">'+monthHtml(y,m,'m1')+monthHtml(next.getFullYear(),next.getMonth(),'m2')+'</div>'+
      '<div class="cal-sum" aria-live="polite">'+summary()+'</div><div class="cal-note">Přeškrtnuté dny jsou obsazené.</div>';
  }
  // Ceny se načítají ze skriptu (nastavují se v administraci, záložka Ceník). Tady žádné nejsou.
  var PRICES=null, priceFailed=false;
  var lastPrice='';
  function kc(n){return n.toLocaleString('cs-CZ').replace(/\s/g,'\u00a0')+'\u00a0Kč';}
  function esc(t){return String(t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function hit(r,md){return r.from<=r.to?(md>=r.from&&md<=r.to):(md>=r.from||md<=r.to);}
  function nightPrice(ds){var md=ds.slice(5),p=PRICES.defaultPrice;PRICES.rules.forEach(function(r){if(hit(r,md))p=r.price;});return p;}
  function coversYear(){var d=new Date(2024,0,1),i,md,ok;for(i=0;i<366;i++){md=p2(d.getMonth()+1)+'-'+p2(d.getDate());ok=PRICES.rules.some(function(r){return hit(r,md);});if(!ok)return false;d.setDate(d.getDate()+1);}return true;}
  function renderTariff(){
    if(!PRICES){
      document.getElementById('tariff').innerHTML='';
      document.getElementById('tariffnote').textContent=priceFailed?'Ceník se nepodařilo načíst. Aktuální ceny vám rádi sdělíme e-mailem na apartman17lipno@gmail.com.':'Načítám ceník…';
      return;
    }
    var h='';PRICES.rules.forEach(function(r){h+='<div><dt>'+esc(r.label)+'</dt><dd>'+kc(r.price)+'</dd></div>';});
    if(!coversYear())h+='<div><dt>Ostatní období</dt><dd>'+kc(PRICES.defaultPrice)+'</dd></div>';
    document.getElementById('tariff').innerHTML=h;
    document.getElementById('tariffnote').innerHTML='K ceně se připočítává jednorázový úklid <strong>'+kc(PRICES.cleaning)+'</strong> a místní poplatek <strong>'+kc(PRICES.perPersonNight)+' za dospělou osobu a noc</strong>. Děti jsou od místního poplatku osvobozeny.';
  }
  function adjustOccupancy(changed){
    var adultsEl=document.getElementById('f-adults'), childrenEl=document.getElementById('f-children');
    var adults=parseInt(adultsEl.value,10)||2, children=parseInt(childrenEl.value,10)||0;
    if(changed==='adults') children=Math.min(children,4-adults);
    if(changed==='children') adults=Math.max(1,Math.min(adults,4-children));
    adults=Math.max(1,Math.min(4,adults));
    children=Math.max(0,Math.min(3,4-adults,children));
    function fill(select,max,value,label){
      select.textContent='';
      for(var n=0;n<=max;n++){
        if(select===adultsEl&&n===0) continue;
        var option=document.createElement('option');option.value=String(n);option.textContent=label(n);
        option.selected=n===value;select.appendChild(option);
      }
    }
    fill(adultsEl,4-children,adults,function(n){return n+(n===1?' dospělá osoba':' dospělé osoby');});
    fill(childrenEl,Math.min(3,4-adults),children,function(n){return n+(n===1?' dítě':' děti');});
    updatePrice();
  }
  function updatePrice(){
    var box=document.getElementById('pricebox'); lastPrice='';
    if(!PRICES||!selFrom||!selTo){box.innerHTML='';return;}
    var groups={},order=[],n=0,sum=0,d;
    for(d=selFrom;d<selTo;d=addDays(d,1)){var pr=nightPrice(d);if(!groups[pr]){groups[pr]=0;order.push(pr);}groups[pr]++;n++;sum+=pr;}
    var adults=parseInt(document.getElementById('f-adults').value,10)||1;
    var children=parseInt(document.getElementById('f-children').value,10)||0;
    var fee=PRICES.perPersonNight*adults*n, total=sum+PRICES.cleaning+fee;
    var people=adults+' '+(adults===1?'dospělá osoba':'dospělé osoby')+', '+children+' '+(children===1?'dítě':'děti');
    var h='';
    order.forEach(function(pr){h+='<div class="r"><span>'+groups[pr]+' × '+kc(pr)+'</span><b>'+kc(groups[pr]*pr)+'</b></div>';});
    h+='<div class="r"><span>Úklid</span><b>'+kc(PRICES.cleaning)+'</b></div>';
    h+='<div class="r"><span>Hosté</span><b>'+people+'</b></div>';
    h+='<div class="r"><span>Místní poplatek '+kc(PRICES.perPersonNight)+' × '+adults+' dospělých × '+n+' '+(n===1?'noc':(n<5?'noci':'nocí'))+'</span><b>'+kc(fee)+'</b></div>';
    h+='<div class="r"><span>Místní poplatek za děti</span><b>0 Kč</b></div>';
    h+='<div class="r tot"><span>Cena za pobyt</span><b>'+kc(total)+'</b></div><small>Orientační nabídka. Děti jsou od místního poplatku osvobozeny; konečnou cenu potvrdíme e-mailem. Po schválení rezervace se hradí záloha 50 % z ceny ubytování bez úklidu a místního poplatku. Doplatek je splatný 14 dní před příjezdem; při rezervaci méně než 14 dní před příjezdem se hradí celá částka. <a href="rezervacni-a-storno-podminky.html">Podrobné podmínky rezervace a storna</a>.</small>';
    box.innerHTML=h; lastPrice=kc(total);
  }
  function sync(){fromEl.value=selFrom;toEl.value=selTo;updatePrice();}
  function reset(){selFrom='';selTo='';limit='9999-12-31';sync();}
  function pick(ds){
    if(selFrom&&!selTo&&ds>selFrom&&ds<=limit){selTo=ds;}
    else if(!busy[ds]&&ds>=today){selFrom=ds;selTo='';limit=limitFor(ds);}
    else return;
    sync();render();
  }
  calEl.addEventListener('click',function(e){
    var t=e.target.closest?e.target.closest('button'):null; if(!t) return;
    if(t.getAttribute('data-nav')){view=new Date(view.getFullYear(),view.getMonth()+ +t.getAttribute('data-nav'),1);render();return;}
    if(t.getAttribute('data-d')) pick(t.getAttribute('data-d'));
  });
  function loadBusy(){
    status='Načítám obsazené termíny…';render();
    return jsonp({action:'busy'}).then(function(j){
      busy={};(j.busy||[]).forEach(function(d){busy[d]=1;});status='';
      if(selFrom&&selTo){for(var d=selFrom;d<selTo;d=addDays(d,1)){if(busy[d]){reset();break;}}}
    }).catch(function(){status='Dostupnost se nepodařilo načíst, termín ověříme po odeslání.';}).then(render);
  }
  var form=document.getElementById('inq');
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var btn=form.querySelector('button[type=submit]');
    var box=document.getElementById('sent');
    if(!box){
      box=document.createElement('div');box.id='sent';box.setAttribute('role','status');
      box.style.cssText='margin-top:20px;padding:18px 20px;border:1px solid var(--line);border-radius:10px;background:var(--bg)';
      form.insertAdjacentElement('afterend',box);
    }
    var mailLink='<a href="mailto:apartman17lipno@gmail.com">apartman17lipno@gmail.com</a>';
    if(!selFrom||!selTo){box.textContent='Vyberte prosím v kalendáři příjezd a odjezd.';return;}
    var adults=parseInt(document.getElementById('f-adults').value,10)||1;
    var children=parseInt(document.getElementById('f-children').value,10)||0;
    var webEl=document.getElementById('f-web');
    var data={email:document.getElementById('f-mail').value,from:selFrom,to:selTo,
      adults:adults,children:children,guests:adults+children,message:document.getElementById('f-msg').value,cot:document.getElementById('f-cot').checked,chair:document.getElementById('f-chair').checked,price:lastPrice,web:webEl?webEl.value:''};
    btn.disabled=true;btn.textContent='Odesílám…';box.textContent='';
    fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'submit',data:data})}).then(function(r){return r.json();})
    .then(function(j){
      if(!j||!j.ok){throw new Error(j&&j.error||'x');}
      box.textContent='Děkujeme, žádost o rezervaci jsme přijali. Nyní čeká na schválení. O jejím stavu vás budeme informovat e-mailem.';
      form.reset();document.getElementById('f-adults').value='2';document.getElementById('f-children').value='0';reset();adjustOccupancy('init');return loadBusy();
    }).catch(function(err){
      var c=err&&err.message;
      if(c==='busy'){box.textContent='Tento termín je bohužel už obsazený. Vyberte prosím jiný.';reset();return loadBusy();}
      if(c==='people'){box.textContent='Počet dospělých a dětí nesmí překročit kapacitu 4 osob.';return;}
      box.innerHTML=(c==='dates')?'Zkontrolujte prosím data pobytu.':'Odeslání se nepodařilo. Napište nám prosím na '+mailLink+'.';
    }).then(function(){btn.disabled=false;btn.textContent='Odeslat poptávku';});
  });
  document.getElementById('f-adults').addEventListener('change',function(){adjustOccupancy('adults');});
  document.getElementById('f-children').addEventListener('change',function(){adjustOccupancy('children');});
  adjustOccupancy('init');
  renderTariff();
  jsonp({action:'prices'}).then(function(j){
    if(j&&j.ok&&j.prices&&Array.isArray(j.prices.rules)){PRICES=j.prices;}
  }).catch(function(){}).then(function(){if(!PRICES)priceFailed=true;renderTariff();updatePrice();});
  render();loadBusy();
})();

