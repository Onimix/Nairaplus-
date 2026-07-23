// ============================================================
// NairaPlus — app-auth.js
// Real authentication via Supabase Auth (replaces the old auth.js)
// ============================================================

async function npRegisterUser({firstName, lastName, email, phone, password, referralCode}){
  email = email.trim().toLowerCase();

  if(!firstName || !lastName || !email || !phone || !password){
    return {success:false, message:'Please fill in every field.'};
  }
  if(password.length < 6){
    return {success:false, message:'Password must be at least 6 characters.'};
  }

  const {data, error} = await supabase.auth.signUp({ email, password });
  if(error){
    return {success:false, message: error.message};
  }

  // Create the profile + wallet row via our server-side function
  const {error: rpcError} = await supabase.rpc('register_profile', {
    p_first_name: firstName,
    p_last_name: lastName,
    p_phone: phone,
    p_email: email,
    p_referred_by: referralCode || null
  });
  if(rpcError){
    return {success:false, message: rpcError.message};
  }

  return {success:true, message:'Account created!'};
}

async function npLoginUser(email, password){
  email = email.trim().toLowerCase();
  const {data, error} = await supabase.auth.signInWithPassword({ email, password });
  if(error){
    return {success:false, message: 'Incorrect email or password.'};
  }
  return {success:true, message:'Welcome back!'};
}

async function npGetSession(){
  const {data: {session}} = await supabase.auth.getSession();
  if(!session) return null;
  const {data: profile} = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
  return profile;
}

async function npLogout(){
  await supabase.auth.signOut();
  window.location.href = 'login.html';
}

// Call at the top of any protected page — returns the profile or redirects
async function npRequireAuth(){
  const profile = await npGetSession();
  if(!profile){
    window.location.href = 'login.html';
    return null;
  }
  return profile;
}
