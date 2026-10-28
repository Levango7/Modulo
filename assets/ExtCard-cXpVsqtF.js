import{_ as e,j as t,ln as n}from"./tokens-CfkOmMmX.js";import{D as r,F as i,H as a,N as o,T as s,a as c,c as l,f as u,h as d,l as f,lt as p,o as m,p as h,r as g,t as _,x as ee,y as v,z as y}from"./_plugin-vue_export-helper-B2hOTz7v.js";import{a as te,c as ne,i as re,n as ie,o as ae,t as oe}from"./extcard-2gEr1DtE.js";import{i as se,t as ce}from"./htmlcard-tjjhPxnS.js";import{t as le}from"./folder-open-BPGCFR7n.js";import{t as ue}from"./plus-NrM-2hcu.js";import{t as de}from"./trash-2-rXIGY4Jk.js";import{n as fe,t as pe}from"./notify-B6pMcZor.js";function me(e,t){let n=[],r=0;for(let i of e){let e=t.addExtCard(i.json);e===null?r++:n.push(`${i.dir}：${e}`)}return{total:e.length,installed:r,skips:n}}function he(e){return e.total===0?`cards 目录里没有卡包 —— 把卡包文件夹（内含 card.json）放进去再扫`:`扫描到 ${e.total} 个：新装 ${e.installed} 个`+(e.skips.length?`，跳过 ${e.skips.length} 个`:``)}var b={key:0,class:`xcard`},x={class:`xhead`},S={class:`xcount`},C={key:0,class:`xlist`},w={class:`xname`},T=[`title`],E={class:`xmeta`},D=[`onClick`],O={key:1,class:`xempty`},k={class:`ximport`},A={key:0,class:`xerr`},j={class:`xrowbtn`},M=[`disabled`],N=[`disabled`],P={key:1,class:`xtip`},F={key:2,class:`xtip`},I={key:3,class:`xskips`},L={key:1,class:`xcard`},R={class:`xbody`},ge=[`title`,`srcdoc`],_e={key:2,class:`xcard`},z=_(d({__name:`ExtCard`,props:{variant:{},chromeless:{type:Boolean},moduleId:{}},setup(d){let _=d,z=v(`cardData`),B=v(`reminders`,null),V=c(()=>!_.moduleId||!te(_.moduleId)),H=y(``),U=y(``),W=c(()=>z.state.extCards);function ve(){let e=z.addExtCard(H.value);if(e){U.value=e;return}H.value=``,U.value=``}function ye(){U.value&&=``}function be(e){z.removeExtCard(e)}let G=y(!1),K=y(``),q=y([]);async function xe(){if(e&&!G.value){G.value=!0,K.value=``,q.value=[];try{let{invoke:e}=await t(async()=>{let{invoke:e}=await import(`./core-DGUCiFc_.js`).then(e=>e.a);return{invoke:e}},[]),n=me(await e(`extcards_scan`),z);q.value=n.skips,K.value=he(n)}catch(e){K.value=`扫描失败：${String(e)}`}finally{G.value=!1}}}function J(e){return e.length===0?`未声明权限`:e.map(e=>e===`state`?`状态`:`通知`).join(` + `)}let Y=c(()=>V.value?null:z.state.extCards.find(e=>re(e.id)===_.moduleId)??null),X=y(null),Se=y(0);function Ce(e){return`<!doctype html><html><head><meta charset="utf-8">
<title>${e.title.replace(/[<>"]/g,``)}</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; background: transparent; color: var(--text-1);
    font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif; }
  body { padding: 8px; }
</style></head>
<body>
<script>
  window.MODULO = { vars: {}, bridge: null };
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.__modulo === 'init') {
      window.MODULO.vars = d.vars || {};
      if (typeof window.onModuloInit === 'function') { try { window.onModuloInit(window.MODULO.vars) } catch (err) {} }
      return;
    }
    if (d.__modulo === 'bridge') {
      var resolve = __pending[d.rid];
      if (!resolve) return;
      delete __pending[d.rid];
      resolve({ ok: !!d.ok, value: d.value, error: d.error });
    }
  });
  var __seq = 0; var __pending = {};
  window.MODULO.bridge = {
    call: function (method, args) {
      return new Promise(function (resolve) {
        var rid = 'r' + (++__seq);
        __pending[rid] = resolve;
        parent.postMessage({ __modulo: 'ext', payload: { bridge: { rid: rid, method: method, args: args === undefined ? null : args } } }, '*');
      });
    },
    getState: function () { return window.MODULO.bridge.call('getState'); },
    setState: function (v) { return window.MODULO.bridge.call('setState', v === undefined ? null : v); },
    notify: function (text) { return window.MODULO.bridge.call('notify', { text: String(text) }); }
  };
  ;(function () {
    var SNIPPET = ${se(e.html)};
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
</body></html>`}function Z(){let e=X.value?.contentWindow;e&&Y.value&&e.postMessage({__modulo:`init`,vars:{title:Y.value.title,dark:document.documentElement.dataset.theme===`dark`,width:X.value?.clientWidth??0,height:X.value?.clientHeight??0}},`*`)}function Q(e,t,n,r){X.value?.contentWindow?.postMessage(ie(e,t,n,r),`*`)}async function we(t,n){B&&fe(e,B.state.settings.systemNotifications)&&await pe([{key:`extcard:${n}`,title:n,body:t}])}function $(e){let t=X.value?.contentWindow??null;if(!Y.value||!ce(e.data,e.source,t))return;let n=ae(e.data.payload);if(!n)return;if(!oe(Y.value.permissions,n.method)){Q(n.rid,!1,void 0,ne(n.method));return}let r=Y.value.id;if(n.method===`getState`)Q(n.rid,!0,JSON.parse(JSON.stringify(z.state.extState[r]??null)));else if(n.method===`setState`){let e=z.setExtState(r,n.args);e===null?Q(n.rid,!0,n.args):Q(n.rid,!1,void 0,e)}else we(n.args.text,Y.value.title),Q(n.rid,!0,null)}return ee(()=>window.removeEventListener(`message`,$)),window.addEventListener(`message`,$),o(()=>document.documentElement.dataset.theme,()=>Z()),(t,o)=>V.value?(s(),f(`div`,b,[m(`header`,x,[o[1]||=m(`span`,{class:`xtitle`},`原生卡`,-1),m(`span`,S,p(W.value.length)+` / `+p(a(8)),1)]),W.value.length?(s(),f(`div`,C,[(s(!0),f(g,null,r(W.value,e=>(s(),f(`div`,{key:e.id,class:`xrow`},[m(`span`,w,p(e.title),1),m(`span`,{class:`xperm`,title:e.permissions.length?`manifest 里声明的宿主能力`:`manifest 没写 permissions —— 桥调用会被拒`},p(J(e.permissions)),9,T),m(`span`,E,p(e.group)+` · `+p(e.variants.length)+` 个形态`,1),m(`button`,{class:`xdel`,title:`卸载这张扩展卡（版面上的实例刷新后消失）`,onClick:t=>be(e.id)},[h(a(de),{size:12})],8,D)]))),128)),o[2]||=m(`p`,{class:`xtip`},`装好的卡在「添加卡片」里，按分组归位；卸载后它的状态一并清除。`,-1)])):(s(),f(`p`,O,`还没有装任何卡包。把卡包 JSON 粘到下面，或在桌面壳里把卡包文件夹放进 cards 目录再扫。`)),m(`div`,k,[i(m(`textarea`,{"onUpdate:modelValue":o[0]||=e=>H.value=e,class:`xtarea`,spellcheck:`false`,"aria-label":`卡包 JSON`,placeholder:`{"id":"hello","title":"问候","html":"<b>你好</b>","variants":[{"id":"std","name":"标准","minW":2,"minH":2,"idealW":3,"idealH":3}]}`,onInput:ye},null,544),[[n,H.value]]),U.value?(s(),f(`p`,A,p(U.value),1)):l(``,!0),m(`div`,j,[m(`button`,{class:`xok`,disabled:!H.value.trim(),onClick:ve},[h(a(ue),{size:11}),o[3]||=u(` 导入卡包`,-1)],8,M),a(e)?(s(),f(`button`,{key:0,class:`xok`,disabled:G.value,title:`扫描应用数据目录下的 cards 文件夹`,onClick:xe},[h(a(le),{size:11}),u(` `+p(G.value?`扫描中…`:`扫描 cards 目录`),1)],8,N)):l(``,!0),o[4]||=m(`span`,{class:`xtip`},`沙箱隔离：碰不到应用数据；桥只有读写自身状态与发通知，且要卡包声明`,-1)]),a(e)?l(``,!0):(s(),f(`p`,P,`扫描是桌面壳的功能（读应用数据目录里的卡包文件夹）；网页版用上面的粘贴导入。`)),K.value?(s(),f(`p`,F,p(K.value),1)):l(``,!0),q.value.length?(s(),f(`div`,I,[(s(!0),f(g,null,r(q.value,(e,t)=>(s(),f(`p`,{key:t,class:`xerr`},`跳过 `+p(e),1))),128))])):l(``,!0)])])):Y.value?(s(),f(`div`,L,[m(`div`,R,[(s(),f(`iframe`,{ref_key:`frameEl`,ref:X,class:`xframe`,sandbox:`allow-scripts`,title:Y.value.title,srcdoc:Ce(Y.value),key:`${Y.value.id}:${Se.value}`,onLoad:Z},null,40,ge))])])):(s(),f(`div`,_e,[...o[5]||=[m(`p`,{class:`xempty`},`这张扩展卡已被卸载。删掉这个格子即可；刷新后版面会自动清掉它。`,-1)]]))}}),[[`__scopeId`,`data-v-2239835f`]]);export{z as default};