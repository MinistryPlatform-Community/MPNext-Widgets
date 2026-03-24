import { redirect } from 'next/navigation';

export { Home as default };

function Home() {
  redirect('/demo');
}
