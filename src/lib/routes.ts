const appBasePath = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

export function appPath(path = "") {
  const relativePath = path.replace(/^\/+/, "");
  return relativePath ? `${appBasePath}${relativePath}` : appBasePath;
}

export function isAdminPath(pathname: string) {
  const route = pathname.startsWith(appBasePath)
    ? `/${pathname.slice(appBasePath.length)}`
    : pathname;
  return route.replace(/\/+$/, "") === "/admin";
}
