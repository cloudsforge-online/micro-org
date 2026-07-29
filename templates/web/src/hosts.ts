// Where the APIs are, resolved at RUNTIME.
//
// WHY not `import.meta.env.VITE_API_URL`: Vite inlines those at build time, so a bundle built
// against staging is a different artifact from the same commit built against production. One
// image would no longer serve every environment, a release manifest could not pin a single
// frontend image, and the promotion path would become 'rebuild', which is not a promotion.
//
// web-ci.yml fails the build if `import.meta.env.VITE_` appears anywhere in this repository.
// That property is easy to lose by accident and expensive to get back.
//
// The host is derived from where the page is being served from. Everything is behind the same
// gateway, on the same apex domain, so the subdomain is all that changes.

export interface Hosts {
  readonly identity: string;
  readonly hub: string;
  readonly gateway: string;
}

export function cloudsforgeHosts(location: Location = window.location): Hosts {
  const { protocol, hostname, port } = location;

  // Local development: everything is on localhost behind different ports, and the gateway is not
  // in the picture. Named explicitly rather than inferred, because inference here fails silently.
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return {
      identity: `${protocol}//${hostname}:4100`,
      hub: `${protocol}//${hostname}:4119`,
      gateway: `${protocol}//${hostname}${port ? `:${port}` : ''}`,
    };
  }

  // Deployed: strip the leading label and rebuild. app.cloudsforge.online -> cloudsforge.online,
  // which is what makes one image serve staging and production unchanged.
  const labels = hostname.split('.');
  const apex = labels.length > 2 ? labels.slice(1).join('.') : hostname;
  return {
    identity: `${protocol}//id.${apex}`,
    hub: `${protocol}//hub.${apex}`,
    gateway: `${protocol}//${apex}`,
  };
}
