import{cn as e,ln as t}from"./tokens-xkAaZ5Kv.js";import{D as n,F as r,H as i,N as a,T as o,a as s,c,f as l,h as u,l as d,lt as f,o as p,p as m,r as h,t as g,x as _,y as v,z as y}from"./_plugin-vue_export-helper-B2hOTz7v.js";import{i as b,t as x}from"./htmlcard-tjjhPxnS.js";import{t as S}from"./createLucideIcon-7zDaQvSM.js";import{t as C}from"./plus-NrM-2hcu.js";import{t as w}from"./refresh-cw-DSYII2xA.js";import{t as T}from"./trash-2-rXIGY4Jk.js";var E=S(`code`,[[`path`,{d:`m16 18 6-6-6-6`,key:`eg8j8`}],[`path`,{d:`m8 6-6 6 6 6`,key:`ppft3o`}]]),D={class:`hcard`},O={class:`hhead`},k=[`value`],A={key:1,class:`htitle`},j={class:`hacts`},M={key:0,class:`hedit`},N={key:0,class:`herr`},P={key:1,class:`hbody`},F=[`title`,`srcdoc`],I={key:0,class:`htoast`},L={key:2,class:`hempty`},R=g(u({__name:`HtmlCard`,props:{variant:{},chromeless:{type:Boolean}},setup(u){let g=v(`cardData`),S=y(``),R=y(!1),z=y(!1),B=y(``),V=y(``),H=y(``),U=y(0),W=y(null),G=y(``),K=s(()=>g.state.htmlCards),q=s(()=>K.value.find(e=>e.id===S.value)??K.value[0]??null);function J(e){return`<!doctype html><html><head><meta charset="utf-8">
<title>${e.title.replace(/[<>"]/g,``)}</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; background: transparent; color: var(--text-1);
    font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif; }
  body { padding: 8px; }
</style></head>
<body>
<script>
  window.MODULO = { vars: {} };
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || d.__modulo !== 'init') return;
    window.MODULO.vars = d.vars || {};
    if (typeof window.onModuloInit === 'function') { try { window.onModuloInit(window.MODULO.vars) } catch (err) {} }
  });
  ;(function () {
    var SNIPPET = ${b(e.html)};
    var parsed = new DOMParser().parseFromString(SNIPPET, 'text/html');
    var nodes = Array.prototype.slice.call(parsed.body.childNodes);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.tagName === 'SCRIPT') {
        var s = document.createElement('script');
        s.textContent = node.textContent || '';
        document.body.appendChild(s);
      } else {
        document.body.appendChild(document.importNode(node, true));
      }
    }
  })();
<\/script>
</body></html>`}function Y(){let e=W.value?.contentWindow;e&&q.value&&e.postMessage({__modulo:`init`,vars:{title:q.value.title,dark:document.documentElement.dataset.theme===`dark`,width:W.value?.clientWidth??0,height:W.value?.clientHeight??0}},`*`)}function X(e){let t=W.value?.contentWindow??null;if(!x(e.data,e.source,t))return;let n=e.data.payload;typeof n.notice==`string`&&(G.value=n.notice.slice(0,120),window.setTimeout(()=>G.value=``,2500))}a(()=>[S.value,U.value],()=>Y(),{flush:`post`}),_(()=>window.removeEventListener(`message`,X)),window.addEventListener(`message`,X);function Z(){z.value=!0,R.value=!1,B.value=``,V.value=`<b>你好</b> —— 这里可以写 HTML，脚本也能跑（沙箱里，碰不到应用数据）`,H.value=``}function Q(){q.value&&(R.value=!0,z.value=!1,B.value=q.value.title,V.value=q.value.html,H.value=``)}function $(){H.value&&=``}function ee(){if(z.value){let e=g.addHtmlCard(B.value,V.value);if(e)return void(H.value=e);let t=K.value[K.value.length-1];t&&(S.value=t.id),z.value=!1}else if(q.value){let e=g.updateHtmlCard(q.value.id,{title:B.value,html:V.value});if(e)return void(H.value=e);R.value=!1}U.value++}function te(){z.value=!1,R.value=!1,H.value=``}function ne(){q.value&&(g.removeHtmlCard(q.value.id),S.value=K.value[0]?.id??``,U.value++)}return a(()=>document.documentElement.dataset.theme,()=>Y()),(a,s)=>(o(),d(`div`,D,[p(`header`,O,[K.value.length>1?r((o(),d(`select`,{key:0,"onUpdate:modelValue":s[0]||=e=>S.value=e,"aria-label":`选择自定卡`,onChange:s[1]||=e=>U.value++},[(o(!0),d(h,null,n(K.value,e=>(o(),d(`option`,{key:e.id,value:e.id},f(e.title),9,k))),128))],544)),[[e,S.value]]):(o(),d(`span`,A,f(q.value?.title??`自定卡`),1)),p(`span`,j,[q.value&&!R.value?(o(),d(`button`,{key:0,title:`编辑片段`,onClick:Q},[m(i(E),{size:12})])):c(``,!0),q.value&&!R.value?(o(),d(`button`,{key:1,title:`重新载入`,onClick:s[2]||=e=>U.value++},[m(i(w),{size:12})])):c(``,!0),q.value&&!R.value?(o(),d(`button`,{key:2,title:`删除这张自定卡`,onClick:ne},[m(i(T),{size:12})])):c(``,!0),!q.value&&!z.value?(o(),d(`button`,{key:3,title:`新建一张自定卡`,onClick:Z},[m(i(C),{size:12})])):c(``,!0)])]),z.value||R.value?(o(),d(`div`,M,[r(p(`input`,{"onUpdate:modelValue":s[3]||=e=>B.value=e,class:`htinput`,placeholder:`卡片小标题（可空）`,"aria-label":`自定卡标题`,onInput:$},null,544),[[t,B.value]]),r(p(`textarea`,{"onUpdate:modelValue":s[4]||=e=>V.value=e,class:`htarea`,spellcheck:`false`,"aria-label":`HTML 片段`,onInput:$,placeholder:`<b>你好</b>：可以写 HTML、<style> 和 <script>（沙箱里跑）`},null,544),[[t,V.value]]),H.value?(o(),d(`p`,N,f(H.value),1)):c(``,!0),p(`div`,{class:`hrow`},[p(`button`,{class:`hok`,onClick:ee},`保存`),p(`button`,{class:`hcancel`,onClick:te},`取消`),s[5]||=p(`span`,{class:`htip`},`片段跑在沙箱里：碰不到应用数据，但其副作用（联网/占 CPU）由你负责`,-1)])])):q.value?(o(),d(`div`,P,[(o(),d(`iframe`,{ref_key:`frameEl`,ref:W,class:`hframe`,sandbox:`allow-scripts`,title:q.value.title,srcdoc:J(q.value),key:`${q.value.id}:${U.value}`,onLoad:Y},null,40,F)),G.value?(o(),d(`p`,I,f(G.value),1)):c(``,!0)])):(o(),d(`div`,L,[s[7]||=p(`p`,null,`还没有自定卡：写一段 HTML，它就会在这里渲染出来。`,-1),p(`button`,{class:`hok`,onClick:Z},[m(i(C),{size:11}),s[6]||=l(` 新建`,-1)]),s[8]||=p(`p`,{class:`htip`},`沙箱隔离：片段跑在独立 origin 里，读不到应用的数据`,-1)]))]))}}),[[`__scopeId`,`data-v-25af00f9`]]);export{R as default};