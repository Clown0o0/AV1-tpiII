import { FonteProfissionaisResiliente } from '../../../src/services/FonteProfissionaisResiliente';
import { criarProfissional, DATA_ENTREGA, DATA_REFERENCIA } from '../../support/fixtures';
import { InMemoryProfissionalRepository } from '../../support/InMemoryRepositories';

const filtro = { papeis: ['DIRETOR' as const], disponivelDe: DATA_REFERENCIA, disponivelAte: DATA_ENTREGA };

describe('FonteProfissionaisResiliente', () => {
  it('filtra o cache pelos mesmos critérios quando o repositório cai', async () => {
    const repo = new InMemoryProfissionalRepository([
      criarProfissional({ id: 'barato', precoMin: 1000 }),
      criarProfissional({ id: 'caro', precoMin: 90000 }),
      criarProfissional({ id: 'editor', especialidades: ['EDITOR'] }),
    ]);
    const falhas: string[] = [];
    const fonte = new FonteProfissionaisResiliente(repo, { aoFalhar: (_e, op) => falhas.push(op) });
    await fonte.buscarPorIds(['barato', 'caro', 'editor']);

    repo.indisponivel = true;
    const resultado = await fonte.buscarCandidatos({ ...filtro, precoMinMaximo: 5000 });
    expect(resultado).toEqual({ profissionais: [expect.objectContaining({ id: 'barato' })], fonte: 'CACHE', erro: 'conexão recusada' });
    const semFiltroPreco = await fonte.buscarCandidatos(filtro);
    expect(semFiltroPreco.profissionais.map((p) => p.id)).toEqual(['barato', 'caro']);
    expect(falhas).toEqual(['buscarCandidatos', 'buscarCandidatos']);
  });

  it('buscarPorIds usa o cache e sinaliza INDISPONIVEL quando não há nada memorizado', async () => {
    const repo = new InMemoryProfissionalRepository([criarProfissional({ id: 'a' })]);
    const fonte = new FonteProfissionaisResiliente(repo);
    await fonte.buscarCandidatos(filtro);
    repo.indisponivel = true;
    expect((await fonte.buscarPorIds(['a', 'b'])).fonte).toBe('CACHE');
    expect((await fonte.buscarPorIds(['b'])).fonte).toBe('INDISPONIVEL');
  });

  it('descarta os itens mais antigos quando o cache excede a capacidade', async () => {
    const repo = new InMemoryProfissionalRepository([criarProfissional({ id: 'a' }), criarProfissional({ id: 'b' }), criarProfissional({ id: 'c' })]);
    const fonte = new FonteProfissionaisResiliente(repo, { capacidadeCache: 2 });
    await fonte.buscarPorIds(['a', 'b', 'c']);
    repo.indisponivel = true;
    const { profissionais } = await fonte.buscarPorIds(['a', 'b', 'c']);
    expect(profissionais.map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('converte erros que não são Error em mensagem', async () => {
    const fonte = new FonteProfissionaisResiliente({
      buscarCandidatos: () => Promise.reject('string de erro'),
      buscarPorIds: () => Promise.reject(42),
    });
    expect((await fonte.buscarCandidatos(filtro)).erro).toBe('string de erro');
    expect((await fonte.buscarPorIds(['x'])).erro).toBe('42');
  });

  it('aplica timeout às consultas lentas', async () => {
    const repo = new InMemoryProfissionalRepository([criarProfissional()]);
    repo.atrasoMs = 100;
    const fonte = new FonteProfissionaisResiliente(repo, { timeoutMs: 10 });
    const resultado = await fonte.buscarCandidatos(filtro);
    expect(resultado.fonte).toBe('INDISPONIVEL');
    expect(resultado.erro).toMatch(/excedeu 10ms/);
  });
});
