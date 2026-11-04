const [major, minor] = process.versions.node.split(".").map(Number);

if (major < 20 || (major === 20 && minor < 9)) {
  console.error(
    "Beyonders uses Next.js 16 and requires Node.js 20.9.0 or newer. " +
    "The active runtime is " + process.version + ". " +
    "Switch to an installed Node.js 22 or 24 release, then rerun this command.",
  );
  process.exit(1);
}
