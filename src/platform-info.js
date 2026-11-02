export const platformCommand = `printf '\\nSSH_HOLD_OS='; uname -s; printf 'SSH_HOLD_ARCH='; uname -m; if [ -r /etc/os-release ]; then sed -n 's/^PRETTY_NAME=/SSH_HOLD_DISTRO=/p' /etc/os-release; fi`;

export function parsePlatform(output) {
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^SSH_HOLD_(OS|ARCH|DISTRO)=(.{1,200})$/);
    if (match && !/[\x00-\x1f\x7f]/.test(match[2])) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return { operatingSystem: values.DISTRO || values.OS || '', architecture: values.ARCH || '' };
}
