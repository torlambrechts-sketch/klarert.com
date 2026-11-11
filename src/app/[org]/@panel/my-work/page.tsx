import { HomePanel } from '@/components/shell/home-panel';

export default async function Panel({ params }: { params: Promise<{ org: string }> }) {
  return <HomePanel org={(await params).org} />;
}
