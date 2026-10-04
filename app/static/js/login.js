function togglePw() {
  const input = document.getElementById('password');
  const eye = document.getElementById('pw-eye');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  eye.innerHTML = show
    ? '<path d="M10.7 5.1A9 9 0 0 1 12 5c6.5 0 10 7 10 7a13 13 0 0 1-2.2 2.9M6.6 6.6A13 13 0 0 0 2 12s3.5 7 10 7a9 9 0 0 0 4-.9"/><path d="m3 3 18 18"/><path d="M9.5 9.5a3 3 0 0 0 4.2 4.2"/>'
    : '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';
}
