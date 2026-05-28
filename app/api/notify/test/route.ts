export async function GET() {
  return Response.json({ error: 'disabled' }, { status: 404 });
}
