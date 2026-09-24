// Developer split view: each pane (iframe) carries its own "view as" in ?pane=<base64url JSON>.
// The value is sent as the X-BR-View-As header and ?view_as= on the stream. The server only honours it
// for a real developer session, so it cannot be abused by other accounts.
const params = new URLSearchParams(window.location.search);
export const PANE: string | null = params.get('pane');
export const IS_PANE = !!PANE;

export function encodePane(v: Record<string, unknown>) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(v)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Keep ?pane= on in-app links inside an embedded pane. */
export const withPane = (to: string) => (PANE ? `${to}${to.includes('?') ? '&' : '?'}pane=${PANE}` : to);
