// Shared --help / unknown-option handling for the helper scripts.
export function checkUsage(usage: string, args = process.argv.slice(2)): string[] {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    process.exit(0);
  }
  const unknown = args.find((a) => a.startsWith('-'));
  if (unknown) {
    console.error(`error: unknown option ${unknown}\n\n${usage}`);
    process.exit(2);
  }
  return args;
}
