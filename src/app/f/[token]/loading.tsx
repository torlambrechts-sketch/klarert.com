import { PageSkeleton } from '@/components/states/skeletons';

export default function Loading() {
  return <PageSkeleton label="Loading the form" rows={4} width="max-w-xl" />;
}
