/* Relais d'import pour le Lecteur de partitions — à coller dans un « Worker » Cloudflare (gratuit).
   Il télécharge un fichier MusicXML à la place de l'appli quand le site d'origine le bloque,
   puis le renvoie avec l'autorisation nécessaire. Voir la notice, partie « Relais d'import ». */
export default {
  async fetch(request) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const target = new URL(request.url).searchParams.get('url');
    if (!target || !/^https?:\/\//i.test(target)) return new Response('Adresse manquante.', { status: 400, headers: cors });
    let r;
    try { r = await fetch(target, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (lecteur-partitions)' } }); }
    catch (e) { return new Response('Site injoignable.', { status: 502, headers: cors }); }
    if (!r.ok) return new Response('Le site a répondu ' + r.status + '.', { status: r.status, headers: cors });
    const len = Number(r.headers.get('content-length') || 0);
    if (len > 8e6) return new Response('Fichier trop gros.', { status: 413, headers: cors });
    const body = await r.arrayBuffer();
    if (body.byteLength > 8e6) return new Response('Fichier trop gros.', { status: 413, headers: cors });
    return new Response(body, { headers: { ...cors, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'max-age=3600' } });
  }
};
