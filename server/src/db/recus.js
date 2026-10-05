/**
 * Numerotation des recus : REC-AAAA-00001, sequentielle par annee civile.
 *
 * Le numero suit le plus grand deja emis pour l annee, et non un comptage
 * des paiements de l annee scolaire : celle-ci chevauche deux annees
 * civiles, et un compteur remis a zero a la rentree reproduirait des
 * numeros deja emis entre janvier et juin (numero_recu est UNIQUE).
 *
 * Un verrou consultatif, libere a la fin de la transaction, empeche deux
 * encaissements simultanes (guichet et Wave) d obtenir le meme numero.
 * A appeler avec le client d une transaction en cours.
 */
export async function prochainNumeroRecu(client, date = new Date()) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('epsin_numero_recu'))`);
  const prefixe = `REC-${date.getFullYear()}-`;
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(substring(numero_recu FROM '^REC-[0-9]{4}-([0-9]+)$')::int), 0) AS dernier
     FROM paiement WHERE numero_recu LIKE $1`,
    [`${prefixe}%`]
  );
  return `${prefixe}${String(rows[0].dernier + 1).padStart(5, '0')}`;
}
