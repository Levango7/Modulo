import{A as e,dn as t,fn as n,k as r}from"./tokens-D-LDlvwg.js";import{D as i,F as a,H as o,N as s,T as c,a as l,c as u,f as d,h as f,l as p,lt as m,o as h,p as g,r as _,t as v,x as y,y as b,z as x}from"./_plugin-vue_export-helper-B2hOTz7v.js";import{t as S}from"./createLucideIcon-7zDaQvSM.js";import{t as C}from"./plus-NrM-2hcu.js";import{t as w}from"./refresh-cw-DSYII2xA.js";import{t as T}from"./trash-2-rXIGY4Jk.js";var E=S(`code`,[[`path`,{d:`m16 18 6-6-6-6`,key:`eg8j8`}],[`path`,{d:`m8 6-6 6 6 6`,key:`ppft3o`}]]),D={class:`hcard`},O={class:`hhead`},k=[`value`],A={key:1,class:`htitle`},j={class:`hacts`},M={key:0,class:`hedit`},N={key:0,class:`herr`},P={key:1,class:`hbody`},F=[`title`,`srcdoc`],I={key:0,class:`htoast`},L={key:2,class:`hempty`},R=v(f({__name:`HtmlCard`,props:{variant:{},chromeless:{type:Boolean}},setup(f){let v=b(`cardData`),S=x(``),R=x(!1),z=x(!1),B=x(``),V=x(``),H=x(``),U=x(0),W=x(null),G=x(``),K=l(()=>v.state.htmlCards),q=l(()=>K.value.find(e=>e.id===S.value)??K.value[0]??null);function J(t){return`<!doctype html><html><head><meta charset="utf-8">
<title>${t.title.replace(/[<>"]/g,``)}</title>
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
    var SNIPPET = ${e(t.html)};
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
</body></html>`}function Y(){let e=W.value?.contentWindow;e&&q.value&&e.postMessage({__modulo:`init`,vars:{title:q.value.title,dark:document.documentElement.dataset.theme===`dark`,width:W.value?.clientWidth??0,height:W.value?.clientHeight??0}},`*`)}function X(e){let t=W.value?.contentWindow??null;if(!r(e.data,e.source,t))return;let n=e.data.payload;typeof n.notice==`string`&&(G.value=n.notice.slice(0,120),window.setTimeout(()=>G.value=``,2500))}s(()=>[S.value,U.value],()=>Y(),{flush:`post`}),y(()=>window.removeEventListener(`message`,X)),window.addEventListener(`message`,X);function Z(){z.value=!0,R.value=!1,B.value=``,V.value=`<b>你好</b> —— 这里可以写 HTML，脚本也能跑（沙箱里，碰不到应用数据）`,H.value=``}function Q(){q.value&&(R.value=!0,z.value=!1,B.value=q.value.title,V.value=q.value.html,H.value=``)}function $(){H.value&&=``}function ee(){if(z.value){let e=v.addHtmlCard(B.value,V.value);if(e)return void(H.value=e);let t=K.value[K.value.length-1];t&&(S.value=t.id),z.value=!1}else if(q.value){let e=v.updateHtmlCard(q.value.id,{title:B.value,html:V.value});if(e)return void(H.value=e);R.value=!1}U.value++}function te(){z.value=!1,R.value=!1,H.value=``}function ne(){q.value&&(v.removeHtmlCard(q.value.id),S.value=K.value[0]?.id??``,U.value++)}return s(()=>document.documentElement.dataset.theme,()=>Y()),(e,r)=>(c(),p(`div`,D,[h(`header`,O,[K.value.length>1?a((c(),p(`select`,{key:0,"onUpdate:modelValue":r[0]||=e=>S.value=e,"aria-label":`选择自定卡`,onChange:r[1]||=e=>U.value++},[(c(!0),p(_,null,i(K.value,e=>(c(),p(`option`,{key:e.id,value:e.id},m(e.title),9,k))),128))],544)),[[t,S.value]]):(c(),p(`span`,A,m(q.value?.title??`自定卡`),1)),h(`span`,j,[q.value&&!R.value?(c(),p(`button`,{key:0,title:`编辑片段`,onClick:Q},[g(o(E),{size:12})])):u(``,!0),q.value&&!R.value?(c(),p(`button`,{key:1,title:`重新载入`,onClick:r[2]||=e=>U.value++},[g(o(w),{size:12})])):u(``,!0),q.value&&!R.value?(c(),p(`button`,{key:2,title:`删除这张自定卡`,onClick:ne},[g(o(T),{size:12})])):u(``,!0),!q.value&&!z.value?(c(),p(`button`,{key:3,title:`新建一张自定卡`,onClick:Z},[g(o(C),{size:12})])):u(``,!0)])]),z.value||R.value?(c(),p(`div`,M,[a(h(`input`,{"onUpdate:modelValue":r[3]||=e=>B.value=e,class:`htinput`,placeholder:`卡片小标题（可空）`,"aria-label":`自定卡标题`,onInput:$},null,544),[[n,B.value]]),a(h(`textarea`,{"onUpdate:modelValue":r[4]||=e=>V.value=e,class:`htarea`,spellcheck:`false`,"aria-label":`HTML 片段`,onInput:$,placeholder:`<b>你好</b>：可以写 HTML、<style> 和 <script>（沙箱里跑）`},null,544),[[n,V.value]]),H.value?(c(),p(`p`,N,m(H.value),1)):u(``,!0),h(`div`,{class:`hrow`},[h(`button`,{class:`hok`,onClick:ee},`保存`),h(`button`,{class:`hcancel`,onClick:te},`取消`),r[5]||=h(`span`,{class:`htip`},`片段跑在沙箱里：碰不到应用数据，但其副作用（联网/占 CPU）由你负责`,-1)])])):q.value?(c(),p(`div`,P,[(c(),p(`iframe`,{ref_key:`frameEl`,ref:W,class:`hframe`,sandbox:`allow-scripts`,title:q.value.title,srcdoc:J(q.value),key:`${q.value.id}:${U.value}`,onLoad:Y},null,40,F)),G.value?(c(),p(`p`,I,m(G.value),1)):u(``,!0)])):(c(),p(`div`,L,[r[7]||=h(`p`,null,`还没有自定卡：写一段 HTML，它就会在这里渲染出来。`,-1),h(`button`,{class:`hok`,onClick:Z},[g(o(C),{size:11}),r[6]||=d(` 新建`,-1)]),r[8]||=h(`p`,{class:`htip`},`沙箱隔离：片段跑在独立 origin 里，读不到应用的数据`,-1)]))]))}}),[[`__scopeId`,`data-v-25af00f9`]]);export{R as default};