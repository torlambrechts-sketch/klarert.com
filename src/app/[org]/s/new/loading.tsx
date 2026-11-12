import { PageSkeleton } from '@/components/states/skeletons';

export default function Loading() {
  return <PageSkeleton label="Loading the new sheet wizard" rows={4} />;
}
