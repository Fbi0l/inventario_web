import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Perfil = "administrador" | "operador" | "consulta";
const validProfiles: Perfil[] = ["administrador", "operador", "consulta"];
const isPerfil = (x: string): x is Perfil => validProfiles.includes(x as Perfil);

// Senhas (1.5.3): de 8 a 128 caracteres e fora de vazamentos conhecidos.
// Have I Been Pwned por k-anonimato: so os 5 primeiros caracteres do SHA-1 da senha
// saem do servidor; a comparacao do restante e feita aqui. Se o servico nao responder,
// a senha e aceita (a verificacao nunca impede o uso do sistema).
const SENHA_MIN=8,SENHA_MAX=128;
async function senhaVazada(password:string):Promise<boolean>{
 try{
  const digest=await crypto.subtle.digest("SHA-1",new TextEncoder().encode(password));
  const hex=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("").toUpperCase();
  const res=await fetch(`https://api.pwnedpasswords.com/range/${hex.slice(0,5)}`,{
   headers:{"Add-Padding":"true","User-Agent":"inventario-web"},signal:AbortSignal.timeout(3000)});
  if(!res.ok)return false;
  const sufixo=hex.slice(5);
  return (await res.text()).split("\n").some(linha=>{const [s,n]=linha.trim().split(":");return s===sufixo&&Number(n)>0;});
 }catch(error){
  console.error("Verificacao de senha vazada indisponivel",error instanceof Error?error.message:String(error));
  return false;
 }
}
const MSG_SENHA_TAMANHO=`A senha deve ter de ${SENHA_MIN} a ${SENHA_MAX} caracteres.`;
const MSG_SENHA_VAZADA="Esta senha aparece em vazamentos de dados conhecidos. Escolha outra.";

function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let j=9;j<11;j++) {
    let sum=0;for(let i=0;i<j;i++)sum+=Number(cpf[i])*(j+1-i);
    const digit=(sum*10)%11;
    if ((digit===10?0:digit)!==Number(cpf[j])) return false;
  }
  return true;
}
function borrowerData(body: any) {
  return { nome:String(body.name||'').trim(), cpf:String(body.cpf||'').replace(/[^0-9]/g,''), telefone:String(body.phone||'').trim() };
}
function validBorrower(d: ReturnType<typeof borrowerData>): boolean {
  return d.nome.length>=3 && d.nome.length<=150 && cpfValido(d.cpf) && d.telefone.length<=30;
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Método não permitido." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return response({ error: "Variáveis do Supabase ausentes." }, 500);

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return response({ error: "Faça login novamente." }, 401);
    const authClient = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return response({ error: "Sessão inválida." }, 401);

    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // A identidade vem do JWT validado, nunca de campos no corpo da requisição.
    const { data: requester, error: roleError } = await admin.from("perfis_usuarios")
      .select("perfil").eq("usuario_id", authData.user.id).single();
    if (roleError || requester?.perfil !== "administrador") {
      return response({ error: "Somente administradores podem gerenciar usuários." }, 403);
    }

    // Trilha de auditoria (1.5.0). Falha ao registrar nao desfaz a acao ja concluida,
    // mas fica no log da funcao. Nunca grava senha, CPF ou telefone.
    const audit = async (acao: string, entidade: string, entidade_id: string | null, descricao: string, detalhes: Record<string, unknown> = {}) => {
      const { error } = await admin.from("auditoria").insert({
        autor_id: authData.user.id, autor_email: authData.user.email ?? null,
        acao, entidade, entidade_id, descricao, detalhes,
      });
      if (error) console.error("Falha ao registrar auditoria", acao, error.message);
    };

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "invite") {
      const bytes=crypto.getRandomValues(new Uint8Array(32));
      const token=btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
      const token_hash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
      const {data:invite,error}=await admin.from("convites_cadastro").insert({
        token_hash,criado_por:authData.user.id,
        expira_em:new Date(Date.now()+48*60*60*1000).toISOString()
      }).select("id").single();
      if(error)return response({error:"Não foi possível salvar o convite: "+error.message},500);
      await audit("gerou_convite","convite",invite?.id??null,"Convite de cadastro válido por 48 horas");
      return response({token,id:invite?.id??null,expires_in_hours:48});
    }

    // Convites ainda utilizaveis (sem uso e dentro da validade). O token nunca e devolvido.
    if (action === "list_invites") {
      const { data, error } = await admin.from("convites_cadastro")
        .select("id,criado_em,expira_em,criado_por")
        .is("usado_em", null).gt("expira_em", new Date().toISOString())
        .order("criado_em", { ascending: false }).limit(200);
      if (error) return response({ error: error.message }, 400);
      return response({ invites: data || [] });
    }

    // Cancelar = vencer o convite agora; o link deixa de funcionar imediatamente.
    if (action === "revoke_invite") {
      const inviteId = String(body.inviteId || "").trim();
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(inviteId)) {
        return response({ error: "Convite inválido." }, 400);
      }
      const now = new Date().toISOString();
      const { data: revoked, error } = await admin.from("convites_cadastro")
        .update({ expira_em: now })
        .eq("id", inviteId).is("usado_em", null).gt("expira_em", now)
        .select("id,criado_em").maybeSingle();
      if (error) return response({ error: error.message }, 400);
      if (!revoked) return response({ error: "Convite não encontrado, já utilizado ou expirado." }, 404);
      await audit("cancelou_convite", "convite", inviteId, "Convite de cadastro cancelado", { gerado_em: revoked.criado_em });
      return response({ message: "Convite cancelado." });
    }

    if (action === "list") {
      const users: any[] = [];
      for (let page = 1; page <= 100; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
        if (error) return response({ error: error.message }, 400);
        users.push(...data.users);
        if (data.users.length < 100) break;
      }
      const { data: personal, error: personalError } = await admin.from("dados_retirantes").select("usuario_id,nome,cpf,telefone");
      if (personalError) return response({ error: personalError.message }, 400);
      const personalMap = new Map((personal || []).map((r) => [r.usuario_id, r]));
      const { data: roles, error: rolesError } = await admin.from("perfis_usuarios")
        .select("usuario_id,perfil");
      if (rolesError) return response({ error: rolesError.message }, 400);
      const map = new Map((roles || []).map((r) => [r.usuario_id, r.perfil]));
      return response({ users: users.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        banned_until: u.banned_until,
        user_metadata: u.user_metadata || {},
        perfil: map.get(u.id) || null,
        dados_retirante: personalMap.get(u.id) || null,
      })) });
    }

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const details = borrowerData(body);
      if (!validBorrower(details)) return response({ error: "Informe nome completo, CPF válido e telefone com até 30 caracteres." },400);
      const name = details.nome;
      const perfil = String(body.perfil || "consulta");
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ error: "E-mail inválido." }, 400);
      if (password.length < SENHA_MIN || password.length > SENHA_MAX) return response({ error: MSG_SENHA_TAMANHO }, 400);
      if (await senhaVazada(password)) return response({ error: MSG_SENHA_VAZADA }, 400);
      if (!isPerfil(perfil)) return response({ error: "Perfil inválido." }, 400);
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: name ? { full_name: name } : {},
      });
      if (error || !data.user) return response({ error: error?.message || "Erro ao criar conta." }, 400);
      const { error: assignError } = await admin.from("perfis_usuarios")
        .upsert({ usuario_id: data.user.id, perfil, atualizado_em: new Date().toISOString() });
      if (assignError) {
        // Evita deixar uma conta criada sem perfil após erro inesperado.
        await admin.auth.admin.deleteUser(data.user.id);
        return response({ error: `Não foi possível atribuir o perfil: ${assignError.message}` }, 500);
      }
      const { error: detailsError } = await admin.from("dados_retirantes").upsert({usuario_id:data.user.id,...details});
      if (detailsError) {
        await admin.auth.admin.deleteUser(data.user.id);
        return response({error:`Não foi possível salvar os dados: ${detailsError.message}`},500);
      }
      await audit("criou", "usuario", data.user.id, email, { perfil });
      return response({ user: { id: data.user.id, email: data.user.email, perfil }, message: "Usuário criado." }, 201);
    }

    if (action === "details") {
      const userId=String(body.userId||"");
      const details=borrowerData(body);
      if (!validBorrower(details)) return response({error:"Informe nome completo e CPF válido."},400);
      const {data:target,error:targetError}=await admin.auth.admin.getUserById(userId);
      if(targetError||!target.user)return response({error:"Usuário não encontrado."},404);
      const {data:previous}=await admin.from("dados_retirantes").select("nome,cpf,telefone").eq("usuario_id",userId).maybeSingle();
      const {error}=await admin.from("dados_retirantes").upsert({usuario_id:userId,...details,atualizado_em:new Date().toISOString()});
      if(error)return response({error:error.message},400);
      // Registra apenas QUAIS campos mudaram, sem os valores pessoais.
      const campos=(["nome","cpf","telefone"] as const).filter(k=>!previous||previous[k]!==details[k]);
      await audit("alterou_dados_retirante","usuario",userId,target.user.email||userId,{campos});
      return response({message:"Dados do retirante atualizados."});
    }
    if (action === "role") {
      const userId = String(body.userId || "");
      const perfil = String(body.perfil || "");
      if (!userId || !isPerfil(perfil)) return response({ error: "Usuário ou perfil inválido." }, 400);
      if (userId === authData.user.id && perfil !== "administrador")
        return response({ error: "Não é permitido retirar seu próprio perfil de administrador." }, 400);
      const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
      if (targetError || !target.user) return response({ error: "Usuário não encontrado." }, 404);
      const { data: previousRole } = await admin.from("perfis_usuarios")
        .select("perfil").eq("usuario_id", userId).maybeSingle();
      const { error } = await admin.from("perfis_usuarios")
        .upsert({ usuario_id: userId, perfil, atualizado_em: new Date().toISOString() });
      if (error) return response({ error: error.message }, 400);
      await audit("alterou_perfil", "usuario", userId, target.user.email || userId, { antes: previousRole?.perfil ?? null, depois: perfil });
      return response({ message: "Perfil alterado." });
    }

    if (action === "delete") {
      const userId = String(body.userId || "").trim();
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(userId)) {
        return response({ error: "Identificador de usuário inválido." }, 400);
      }
      if (userId === authData.user.id) {
        return response({ error: "Você não pode excluir sua própria conta." }, 400);
      }
      const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
      if (targetError || !target.user) return response({ error: "Usuário não encontrado." }, 404);
      const { data: previousRole } = await admin.from("perfis_usuarios")
        .select("perfil").eq("usuario_id", userId).maybeSingle();
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return response({ error: error.message }, 400);
      await audit("excluiu", "usuario", userId, target.user.email || userId, { perfil: previousRole?.perfil ?? null });
      return response({ message: "Usuário excluído com sucesso." });
    }
    if (action === "access") {
      const userId = String(body.userId || "");
      const blocked = body.blocked === true;
      if (!userId) return response({ error: "Informe o usuário." }, 400);
      if (userId === authData.user.id) return response({ error: "Você não pode bloquear sua própria conta." }, 400);
      const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
      if (targetError || !target.user) return response({ error: "Usuário não encontrado." }, 404);
      const { error } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: blocked ? "876000h" : "none",
      });
      if (error) return response({ error: error.message }, 400);
      await audit(blocked ? "bloqueou" : "desbloqueou", "usuario", userId, target.user.email || userId);
      return response({ message: blocked ? "Conta bloqueada." : "Conta desbloqueada." });
    }

    if (action === "password") {
      const userId = String(body.userId || "");
      const password = String(body.password || "");
      if (!userId) return response({ error: "Informe o usuário." }, 400);
      if (password.length < SENHA_MIN || password.length > SENHA_MAX) return response({ error: MSG_SENHA_TAMANHO }, 400);
      if (await senhaVazada(password)) return response({ error: MSG_SENHA_VAZADA }, 400);
      const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
      if (targetError || !target.user) return response({ error: "Usuário não encontrado." }, 404);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return response({ error: error.message }, 400);
      await audit("alterou_senha", "usuario", userId, target.user.email || userId);
      return response({ message: "Senha atualizada." });
    }

    return response({ error: "Ação não reconhecida." }, 400);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Erro interno." }, 500);
  }
});
