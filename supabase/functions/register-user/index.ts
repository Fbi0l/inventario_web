import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS"
};
function response(body:unknown,status=200){
 return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json","Cache-Control":"no-store"}});
}
function cpfValido(cpf:string){
 if(!/^\d{11}$/.test(cpf)||/^(\d)\1{10}$/.test(cpf))return false;
 for(let j=9;j<11;j++){let sum=0;for(let i=0;i<j;i++)sum+=Number(cpf[i])*(j+1-i);const d=sum*10%11;if((d===10?0:d)!==Number(cpf[j]))return false;}
 return true;
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return response({error:"Método não permitido."},405);
 const url=Deno.env.get("SUPABASE_URL");
 const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return response({error:"Configuração indisponível."},500);
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 let hash="",reservation="",createdUser="";
 try{
  const body=await req.json();
  const token=String(body.token||"");
  const name=String(body.name||"").trim(),cpf=String(body.cpf||"").replace(/\D/g,""),phone=String(body.phone||"").trim();
  const email=String(body.email||"").trim().toLowerCase(),password=String(body.password||"");
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))return response({error:"Convite inválido."},400);
  if(name.length<3||name.length>150||!cpfValido(cpf)||phone.length>30||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8||password.length>128)
   return response({error:"Confira nome, CPF, e-mail, telefone e senha (8 a 128 caracteres)."},400);
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
  hash=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
  reservation=crypto.randomUUID();
  const {data:reserved,error:reserveError}=await admin.rpc("reservar_convite_cadastro",{p_hash:hash,p_reserva:reservation});
  if(reserveError)throw reserveError;
  if(!reserved)return response({error:"Convite expirado, utilizado ou indisponível. Solicite outro ao administrador."},409);
  const {data:created,error:createError}=await admin.auth.admin.createUser({
   email,password,email_confirm:true,user_metadata:{full_name:name}
  });
  if(createError||!created.user)return response({error:createError?.message||"Não foi possível criar a conta."},400);
  createdUser=created.user.id;
  const {error:roleError}=await admin.from("perfis_usuarios").insert({usuario_id:createdUser,perfil:"consulta"});
  if(roleError)throw roleError;
  const {error:detailsError}=await admin.from("dados_retirantes").insert({usuario_id:createdUser,nome:name,cpf,telefone:phone});
  if(detailsError)throw detailsError;
  const {data:used,error:finalizeError}=await admin.rpc("finalizar_convite_cadastro",{p_hash:hash,p_reserva:reservation,p_user:createdUser});
  if(finalizeError||!used)throw finalizeError||new Error("Não foi possível finalizar o convite.");
  const newUser=createdUser;
  createdUser="";reservation="";
  // Trilha de auditoria (1.5.0): falha aqui nao desfaz o cadastro concluido.
  const {error:auditError}=await admin.from("auditoria").insert({autor_id:newUser,autor_email:email,acao:"cadastrou_por_convite",entidade:"usuario",entidade_id:newUser,descricao:email,detalhes:{perfil:"consulta"}});
  if(auditError)console.error("Falha ao registrar auditoria",auditError.message);
  return response({message:"Cadastro criado como Consulta. O administrador pode alterar o perfil em Usuarios."},201);
 }catch(error){
  return response({error:error instanceof Error?error.message:"Erro no cadastro."},500);
 }finally{
  if(createdUser){const {error}=await admin.auth.admin.deleteUser(createdUser);if(error)console.error("Falha ao reverter usuário",error.message);}
  if(hash&&reservation){const {error}=await admin.rpc("liberar_convite_cadastro",{p_hash:hash,p_reserva:reservation});if(error)console.error("Falha ao liberar reserva",error.message);}
 }
});
